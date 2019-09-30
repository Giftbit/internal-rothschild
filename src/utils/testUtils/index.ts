import * as cassava from "cassava";
import * as chai from "chai";
import * as fs from "fs";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as mysql from "mysql2/promise";
import * as path from "path";
import {getDbCredentials} from "../dbUtils/connection";
import {initializeCodeCryptographySecrets} from "../codeCryptoUtils";
import {Currency} from "../../model/Currency";
import {Value} from "../../model/Value";
import {CheckoutRequest} from "../../model/TransactionRequest";
import {Transaction} from "../../model/Transaction";
import {TestUser} from "./TestUser";
import {ParsedProxyResponse} from "./ParsedProxyResponse";
import {ParsedCsvProxyResponse} from "./ParsedCsvProxyResponse";
import log = require("loglevel");
import uuid = require("uuid");

const rolesConfig = require("./rolesConfig.json");

if (!process.env["TEST_ENV"]) {
    log.error("Env var TEST_ENV is undefined.  This is not a test environment!");
    throw new Error("Env var TEST_ENV is undefined.  This is not a test environment!");
}

export function generateId(length?: number): string {
    return (uuid.v4() + uuid.v4()).substring(0, length != null ? length : 20);
}

export const defaultTestUser = new TestUser({
    userId: "default-test-user-TEST",

    /**
     * See .env.example for Stripe config details
     * This is "merchant" (connected account) config from stripe test account//pass: integrationtesting+merchant@giftbit.com // x39Rlf4TH3pzn29hsb#
     */
    stripeAccountId: "acct_1BOVE6CM9MOvFvZK"
});
export const alternateTestUser = new TestUser({
    userId: "alternate-test-user-TEST"
});

/**
 * Make a simple authed request to the router with the default test user.
 */
export const testAuthedRequest: <T>(router: cassava.Router, url: string, method: string, body?: any) => Promise<ParsedProxyResponse<T>> = defaultTestUser.request.bind(defaultTestUser);

/**
 * Make a simple authed request for CSV to the router with the default test user.
 */
export const testAuthedCsvRequest: <T>(router: cassava.Router, url: string, method: string, body?: any) => Promise<ParsedCsvProxyResponse<T>> = defaultTestUser.requestCsv.bind(defaultTestUser);

/**
 * A Cassava Route that enables authorization with the above JWTs.
 */
export const authRoute: cassava.routes.Route = new giftbitRoutes.jwtauth.JwtAuthorizationRoute({
    authConfigPromise: Promise.resolve({secretkey: "secret"}),
    rolesConfigPromise: Promise.resolve(rolesConfig),
    infoLogFunction: () => {
        // too noisy for testing
    },
    errorLogFunction: log.error
});

let fullMigrationHasRun = false;

export async function resetDb(): Promise<void> {
    const credentials = await getDbCredentials();
    const connection = await mysql.createConnection({
        // multipleStatements = true removes a protection against injection attacks.
        // We're running scripts and not accepting user input here so that's ok,
        // but other clients should *not* do that.
        multipleStatements: true,
        host: process.env["DB_ENDPOINT"],
        port: +process.env["DB_PORT"],
        user: credentials.username,
        password: credentials.password
    });

    try {
        if (!fullMigrationHasRun) {
            await runSqlMigrations(connection);
            fullMigrationHasRun = true;
        } else {
            await truncateTables(connection);
        }
    } catch (err) {
        log.error("Error setting up DB for test:", err.message);
        log.error("Fetching InnoDB status...");
        try {
            const [statusRes] = await connection.query("SHOW ENGINE INNODB STATUS");
            if (statusRes.length === 1 && statusRes[0].Status) {
                for (const line of statusRes[0].Status.split("\\n")) {
                    log.error(line);
                }
            }
        } catch (err2) {
            log.error("Error fetching InnoDB status:", err2.message);
        }

        throw err;
    } finally {
        await connection.end();
    }
}

async function runSqlMigrations(connection: any): Promise<void> {
    const [schemaRes] = await connection.query("SELECT schema_name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?", ["rothschild"]);
    if (schemaRes.length > 0) {
        try {
            await connection.query("DROP USER readonly");
        } catch (err) {
            // Can error because the user didn't exist. There isn't a great way to do `DROP USER IF EXISTS readonly` in mysql 5.6.
        }
        await connection.query("DROP DATABASE rothschild");
    }

    await connection.query("CREATE DATABASE rothschild");

    for (const file of await getSqlMigrationFiles()) {
        try {
            await connection.query(file.sql);
        } catch (err) {
            log.error(`Error processing migration file ${file.filename}:`, err.message);
            throw err;
        }
    }
}

/**
 * Cache the SQL to save time because we do this a lot.
 */
let truncateTablesSql: string = null;

/**
 * Truncate all data in all tables in the schema.  This is faster
 * than running all migrations if we're sure the schema is correct
 * (eg: 1:22 vs 2:40 on 721 tests)
 */
async function truncateTables(connection: any): Promise<void> {
    if (!truncateTablesSql) {
        const [tables] = await connection.query("SELECT table_name as tableName\n" +
            "FROM   information_schema.tables\n" +
            "WHERE  table_type   = 'BASE TABLE'\n" +
            "  AND  table_schema  = ?;", ["rothschild"]);

        // Manually gluing together SQL is dangerous and we never do it in production.
        truncateTablesSql = "SET FOREIGN_KEY_CHECKS=0; ";
        for (const row of tables) {
            truncateTablesSql += `TRUNCATE rothschild.\`${row.tableName}\`; `;
        }
        truncateTablesSql += "SET FOREIGN_KEY_CHECKS=1;";
    }

    await connection.query(truncateTablesSql);
}

/**
 * Cached contents of SQL migration files.
 */
const sqlMigrationFiles: { filename: string, sql: string }[] = [];

async function getSqlMigrationFiles(): Promise<{ filename: string, sql: string }[]> {
    if (sqlMigrationFiles.length > 0) {
        return sqlMigrationFiles;
    }

    const sqlDir = path.join(__dirname, "..", "..", "lambdas", "postDeploy", "schema");

    const sortedMigrationFileNames: string[] = fs.readdirSync(sqlDir).sort((f1, f2) => {
        const f1Num: number = +f1.substring(1, f1.indexOf("__"));
        const f2Num: number = +f2.substring(1, f2.indexOf("__"));
        return f1Num - f2Num;
    });
    for (const sqlFile of sortedMigrationFileNames) {
        if (!/V\d+__.*\.sql/.test(sqlFile)) {
            throw new Error(`SQL migration file name ${sqlFile} does not match expected format V#__*.sql`);
        }
        sqlMigrationFiles.push({
            filename: sqlFile,
            sql: fs.readFileSync(path.join(sqlDir, sqlFile)).toString("utf8")
        });
    }

    return sqlMigrationFiles;
}

export function generateFullcode(length?: number) {
    return (uuid.v4() + uuid.v4()).replace("-", "").toUpperCase().substring(0, length != null ? length : 10);
}

export async function setCodeCryptographySecrets() {
    return await initializeCodeCryptographySecrets(Promise.resolve({
        encryptionSecret: "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea",
        lookupHashSecret: "ae8645165cc7533dbcc84aeb21c7d6553a38271b7e3402f99d16b8a8717847e1"
    }));
}

export async function createUSD(router: cassava.Router): Promise<Currency> {
    const getCurrencyResp = await testAuthedRequest<Currency>(router, "/v2/currencies/USD", "GET");
    if (getCurrencyResp.statusCode === 200) {
        return getCurrencyResp.body;
    } else {
        const createCurrencyResp = await testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "USD",
            symbol: "$",
            decimalPlaces: 2,
            name: "USD"
        });
        chai.assert.equal(createCurrencyResp.statusCode, 201, `currencyResp.body=${JSON.stringify(createCurrencyResp.body)}`);
        return createCurrencyResp.body;
    }
}

export async function createUSDValue(router: cassava.Router, valueProps?: Partial<Value>): Promise<Value> {
    const baseValueProps: Partial<Value> = {
        id: generateId(),
        currency: "USD",
        balance: 50
    };
    const valueResp = await testAuthedRequest<Value>(router, "/v2/values", "POST", {
        ...baseValueProps,
        ...valueProps
    });
    chai.assert.equal(valueResp.statusCode, 201, `valueResp.body=${JSON.stringify(valueResp.body)}`);
    return valueResp.body;
}

export async function createUSDCheckout(router: cassava.Router, checkoutProps?: Partial<CheckoutRequest>, chargeStripe: boolean = true): Promise<{ checkout: Transaction, valuesCharged: Value[] }> {
    await createUSD(router);

    let baseCheckoutProps: Partial<CheckoutRequest> = {
        id: generateId(),
        currency: "USD",
        lineItems: [{
            type: "product",
            productId: "pid",
            unitPrice: 1000
        }],
        sources: []
    };

    const chargingStripe = chargeStripe || (checkoutProps && checkoutProps.sources && checkoutProps.sources.find(src => src.rail === "stripe"));
    const stripeSourceSupplied = (checkoutProps && checkoutProps.sources && checkoutProps.sources.find(src => src.rail === "stripe"));
    if (chargeStripe && !stripeSourceSupplied) {
        baseCheckoutProps.sources.push({
            rail: "stripe",
            source: "tok_visa"
        });
    }

    const lightrailSourceSupplied = (checkoutProps && checkoutProps.sources && checkoutProps.sources.find(src => src.rail === "lightrail"));
    if (!lightrailSourceSupplied) {
        const value = await createUSDValue(router, chargingStripe ? null : {balance: 1000}); // if not charging stripe, create a value with enough balance to cover the default transaction
        baseCheckoutProps.sources.push({
            rail: "lightrail",
            valueId: value.id
        });
    }

    const checkoutRequest: Partial<CheckoutRequest> = {
        ...baseCheckoutProps,
        ...checkoutProps
    };

    const values: Value[] = [];
    checkoutRequest.sources.forEach(async src => {
        if (src.rail === "lightrail" && src.valueId) {
            values.push((await testAuthedRequest<Value>(router, `/v2/values/${src.valueId}`, "GET")).body);
        }
    });

    const checkoutResp = await testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
    chai.assert.equal(checkoutResp.statusCode, 201, `checkoutResp.body=${JSON.stringify(checkoutResp.body)}`);

    return {checkout: checkoutResp.body, valuesCharged: values};
}

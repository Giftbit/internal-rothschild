import * as cassava from "cassava";
import * as chai from "chai";
import * as fs from "fs";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as mysql from "mysql2/promise";
import * as path from "path";
import {getDbCredentials} from "../dbUtils/connection";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {initializeCodeCryptographySecrets} from "../codeCryptoUtils";
import log = require("loglevel");
import papaparse = require("papaparse");
import uuid = require("uuid");

const rolesConfig = require("./rolesConfig.json");

if (!process.env["TEST_ENV"]) {
    log.error("Env var TEST_ENV is undefined.  This is not a test environment!");
    throw new Error("Env var TEST_ENV is undefined.  This is not a test environment!");
}

export const defaultTestUser = {
    userId: "default-test-user-TEST",
    jwt: "eyJ2ZXIiOjIsInZhdiI6MSwiYWxnIjoiSFMyNTYiLCJ0eXAiOiJKV1QifQ.eyJnIjp7Imd1aSI6ImRlZmF1bHQtdGVzdC11c2VyLVRFU1QiLCJnbWkiOiJkZWZhdWx0LXRlc3QtdXNlci1URVNUIiwidG1pIjoiZGVmYXVsdC10ZXN0LXVzZXItVEVTVCJ9LCJpYXQiOiIyMDE3LTAzLTA3VDE4OjM0OjA2LjYwMyswMDAwIiwianRpIjoiYmFkZ2UtZGQ5NWI5YjU4MmU4NDBlY2JhMWNiZjQxMzY1ZDU3ZTEiLCJzY29wZXMiOltdLCJyb2xlcyI6WyJhY2NvdW50TWFuYWdlciIsImNvbnRhY3RNYW5hZ2VyIiwiY3VzdG9tZXJTZXJ2aWNlTWFuYWdlciIsImN1c3RvbWVyU2VydmljZVJlcHJlc2VudGF0aXZlIiwicG9pbnRPZlNhbGUiLCJwcm9ncmFtTWFuYWdlciIsInByb21vdGVyIiwicmVwb3J0ZXIiLCJzZWN1cml0eU1hbmFnZXIiLCJ0ZWFtQWRtaW4iLCJ3ZWJQb3J0YWwiXX0.Pz9XaaNX3HenvSUb6MENm_KEBheztiscGr2h2TJfhIc",
    auth: new AuthorizationBadge({
        "g": {
            "gui": "default-test-user-TEST",
            "gmi": "default-test-user-TEST",
            "tmi": "default-test-user-TEST",
        },
        "iat": "2017-03-07T18:34:06.603+0000",
        "jti": "badge-dd95b9b582e840ecba1cbf41365d57e1",
        "scopes": [],
        "roles": [
            "accountManager",
            "contactManager",
            "customerServiceManager",
            "customerServiceRepresentative",
            "pointOfSale",
            "programManager",
            "promoter",
            "reporter",
            "securityManager",
            "teamAdmin",
            "webPortal"
        ]
    })
};

export const alternateTestUser = {
    userId: "alternate-test-user-TEST",
    jwt: "eyJ2ZXIiOjIsInZhdiI6MSwiYWxnIjoiSFMyNTYiLCJ0eXAiOiJKV1QifQ.eyJnIjp7Imd1aSI6ImFsdGVybmF0ZS10ZXN0LXVzZXItVEVTVCIsImdtaSI6ImFsdGVybmF0ZS10ZXN0LXVzZXItVEVTVCIsInRtaSI6ImFsdGVybmF0ZS10ZXN0LXVzZXItVEVTVCJ9LCJpYXQiOiIyMDE4LTAzLTIzVDIxOjI1OjI2LjgxMiswMDAwIiwianRpIjoiYmFkZ2UtMmYxOGZkMjk2YmNkNDg4ZWFkODUzNTllYjY2ODA0MTkiLCJzY29wZXMiOltdLCJyb2xlcyI6WyJhY2NvdW50TWFuYWdlciIsImNvbnRhY3RNYW5hZ2VyIiwiY3VzdG9tZXJTZXJ2aWNlTWFuYWdlciIsImN1c3RvbWVyU2VydmljZVJlcHJlc2VudGF0aXZlIiwicG9pbnRPZlNhbGUiLCJwcm9ncmFtTWFuYWdlciIsInByb21vdGVyIiwicmVwb3J0ZXIiLCJzZWN1cml0eU1hbmFnZXIiLCJ0ZWFtQWRtaW4iLCJ3ZWJQb3J0YWwiXX0.9Xdsk8q4dLTp5baeeP_kHi61C0jU8pvFshUhCmoDLbY",
    auth: new AuthorizationBadge({
        "g": {
            "gui": "alternate-test-user-TEST",
            "gmi": "alternate-test-user-TEST",
            "tmi": "alternate-test-user-TEST"
        },
        "iat": "2018-03-23T21:25:26.812+0000",
        "jti": "badge-2f18fd296bcd488ead85359eb6680419",
        "scopes": [],
        "roles": [
            "accountManager",
            "contactManager",
            "customerServiceManager",
            "customerServiceRepresentative",
            "pointOfSale",
            "programManager",
            "promoter",
            "reporter",
            "securityManager",
            "teamAdmin",
            "webPortal"
        ]
    })
};

/**
 * A Cassava Route that enables authorization with the above JWTs.
 */
export const authRoute: cassava.routes.Route = new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"}), Promise.resolve(rolesConfig));

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
        const [schemaRes] = await connection.query("SELECT schema_name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?", ["rothschild"]);
        if (schemaRes.length > 0) {
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
    }

    await connection.end();
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

export interface ParsedProxyResponse<T> {
    statusCode: number;
    headers: {
        [key: string]: string;
    };
    body: T;
}

/**
 * Make a simple authed request to the router with the default test user.
 */
export async function testAuthedRequest<T>(router: cassava.Router, url: string, method: string, body?: any): Promise<ParsedProxyResponse<T>> {
    const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(url, method, {
        headers: {
            Authorization: `Bearer ${defaultTestUser.jwt}`
        },
        body: body && JSON.stringify(body) || undefined
    }));

    chai.assert.equal(resp.headers["Content-Type"], "application/json");

    return {
        statusCode: resp.statusCode,
        headers: resp.headers,
        body: resp.body && JSON.parse(resp.body) || undefined
    };
}

export interface ParsedCsvProxyResponse<T> {
    statusCode: number;
    headers: {
        [key: string]: string;
    };
    body: T[];
}

/**
 * Make a simple authed request for CSV to the router with the default test user.
 */
export async function testAuthedCsvRequest<T>(router: cassava.Router, url: string, method: string, body?: any): Promise<ParsedCsvProxyResponse<T>> {
    const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(url, method, {
        headers: {
            Authorization: `Bearer ${defaultTestUser.jwt}`,
            Accept: "text/csv"
        },
        body: body && JSON.stringify(body) || undefined
    }));

    const parseRes = papaparse.parse(resp.body, {
        dynamicTyping: true,
        header: true,
        delimiter: ","
    });
    chai.assert.equal(resp.headers["Content-Type"], "text/csv");
    chai.assert.deepEqual(parseRes.errors, [], "csv parsing 0 errors");

    return {
        statusCode: resp.statusCode,
        headers: resp.headers,
        body: parseRes.data
    };
}

export function generateId(): string {
    return uuid.v4().substring(0, 20);
}

export async function setCodeCryptographySecrets() {
    return await initializeCodeCryptographySecrets(Promise.resolve({
        encryptionSecret: "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea",
        lookupHashSecret: "ae8645165cc7533dbcc84aeb21c7d6553a38271b7e3402f99d16b8a8717847e1",
        intercomSecret: "FAKE_INTERCOM_SECRET"
    }));
}

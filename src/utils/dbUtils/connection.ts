import * as aws from "aws-sdk";
import log = require("loglevel");
import knex = require("knex");

let dbCredentials: { username: string, password: string } = null;
const isTestEnv = !!process.env["TEST_ENV"];

let knexWriteClient: knex = null;
let knexReadClient: knex = null;

export async function getDbCredentials(): Promise<{ username: string, password: string }> {
    if (dbCredentials) {
        return dbCredentials;
    }

    if (isTestEnv && process.env["DB_PASSWORD"]) {
        // Passing in the DB password through plaintext is only acceptable in testing.
        return dbCredentials = {
            username: process.env["DB_USERNAME"],
            password: process.env["DB_PASSWORD"]
        };
    }

    checkForEnvVar("AWS_REGION", "DB_USERNAME", "DB_PASSWORD_PARAMETER");

    const ssm = new aws.SSM({
        apiVersion: "2014-11-06",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    log.info("fetching db credentials");
    const resp = await ssm.getParameter({
        Name: process.env["DB_PASSWORD_PARAMETER"],
        WithDecryption: true
    }).promise();

    if (!resp.Parameter) {
        throw new Error(`Could not find SSM parameter ${process.env["DB_PASSWORD_PARAMETER"]}`);
    }
    log.info("got db credentials");

    return dbCredentials = {
        username: process.env["DB_USERNAME"],
        password: resp.Parameter.Value
    };
}

/**
 * Get a read/write Knex instance.  This instance holds a connection pool that releases
 * connections when the process is shut down.
 */
export async function getKnexWrite(): Promise<knex> {
    if (knexWriteClient) {
        return knexWriteClient;
    }

    checkForEnvVar("DB_ENDPOINT", "DB_PORT");
    const credentials = await getDbCredentials();
    return knexWriteClient = getKnex(credentials.username, credentials.password, process.env["DB_ENDPOINT"], process.env["DB_PORT"]);
}

/**
 * Get a read only Knex instance.  This instance holds a connection pool that releases
 * connections when the process is shut down.
 */
export async function getKnexRead(): Promise<knex> {
    if (knexReadClient) {
        return knexReadClient;
    }

    checkForEnvVar("DB_READ_ENDPOINT", "DB_PORT");
    const credentials = await getDbCredentials();
    knexReadClient = getKnex(credentials.username, credentials.password, process.env["DB_READ_ENDPOINT"], process.env["DB_PORT"]);

    if (isTestEnv) {
        // Hack Knex to be sure we're not trying to modify the DB through the read-only connection.
        knexReadClient.decrement = knexReadClient.increment = knexReadClient.insert = knexReadClient.into = knexReadClient.update = () => {
            throw new Error("Attempting to modify database from read-only connection.");
        };

        const originalQueryBuilder = knexReadClient.queryBuilder;
        Object.defineProperty(knexReadClient, "queryBuilder", function (...args) {
            const qb = originalQueryBuilder.apply(knexReadClient, args);
            qb.decrement = qb.increment = qb.insert = qb.into = qb.update = () => {
                throw new Error("Attempting to modify database from read-only connection.");
            };
            return qb;
        });

        // Knex 0.16 keeps a private context instance that is accessed when calling Knex("TableName").
        const originalContextQueryBuilder = (knexReadClient as any).context.queryBuilder;
        (knexReadClient as any).context.queryBuilder = function (...args) {
            const qb = originalContextQueryBuilder.apply((knexReadClient as any).context, args);
            qb.decrement = qb.increment = qb.insert = qb.into = qb.update = () => {
                throw new Error("Attempting to modify database from read-only connection.");
            };
            return qb;
        };
    }

    return knexReadClient;
}

function getKnex(username: string, password: string, endpoint: string, port: string): knex {
    log.info(`connecting to ${endpoint}:${port}`);
    return knex({
        // debug: true,     // uncomment to dump very verbose SQL statement info to console.log
        client: "mysql2",
        connection: {
            host: endpoint,
            port: +port,
            user: username,
            password: password,
            database: "rothschild",
            timezone: "Z",
            typeCast: function (field, next) {
                if (field.type === "TINY" && field.length === 1) {
                    // MySQL does not have a true boolean type.  Convert tinyint(1) to boolean.
                    const val = field.string();
                    if (val === null) {
                        return null;
                    } else {
                        return val === "1";
                    }
                }
                if (field.type === "DATETIME") {
                    const value = field.string();
                    if (!value) {
                        return null;
                    }
                    return new Date(value + "Z");
                }
                return next();
            }
        },
        pool: {
            min: 1,
            max: 1
        }
    });
}

/**
 * Check for the existence of the given environment variables and throw an
 * Error if they're missing.
 */
function checkForEnvVar(...envVars: string[]): void {
    for (const envVar of envVars) {
        if (!process.env[envVar]) {
            throw new Error(`env var ${envVar} not set`);
        }
    }
}

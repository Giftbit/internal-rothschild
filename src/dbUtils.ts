import * as aws from "aws-sdk";
import * as knex from "knex";

let dbCredentials: {username: string, password: string} = null;
const isTestEnv = !!process.env["TEST_ENV"];

let knexClient: knex = null;
let knexReadClient: knex = null;

export async function getDbCredentials(): Promise<{username: string, password: string}> {
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

    console.log("fetching db credential parameters");
    const resp = await ssm.getParameter({
        Name: process.env["DB_PASSWORD_PARAMETER"],
        WithDecryption: true
    }).promise();

    if (!resp.Parameter) {
        throw new Error(`Could not find SSM parameter ${process.env["DB_PASSWORD_PARAMETER"]}`);
    }

    return dbCredentials = {
        username: process.env["DB_USERNAME"],
        password: resp.Parameter.Value
    };
}

/**
 * Get a Knex instance.  This instance holds a connection pool that releases
 * connections when the process is shut down.
 */
export async function getKnex(): Promise<knex> {
    if (knexClient) {
        return knexClient;
    }

    checkForEnvVar("DB_ENDPOINT", "DB_PORT");

    const credentials = await getDbCredentials();
    !isTestEnv && console.log(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
    return knexClient = knex({
        client: "mysql",
        connection: {
            host: process.env["DB_ENDPOINT"],
            port: +process.env["DB_PORT"],
            user: credentials.username,
            password: credentials.password,
            database: "rothschild",
            timezone: "Z"
        },
        pool: {
            min: 1,
            max: 1
        }
    });
}

export async function getKnexRead(): Promise<knex> {
    if (knexReadClient) {
        return knexReadClient;
    }

    checkForEnvVar("DB_READ_ENDPOINT", "DB_PORT");

    const credentials = await getDbCredentials();
    !isTestEnv && console.log(`connecting to ${process.env["DB_READ_ENDPOINT"]}:${process.env["DB_PORT"]}`);
    return knexReadClient = knex({
        client: "mysql",
        connection: {
            host: process.env["DB_READ_ENDPOINT"],
            port: +process.env["DB_PORT"],
            user: credentials.username,
            password: credentials.password,
            database: "rothschild",
            timezone: "Z"
        },
        pool: {
            min: 1,
            max: 1
        }
    });
}

/**
 * Check for the existence of the given envionment variables and throw an
 * Error if they're missing.
 */
function checkForEnvVar(...envVars: string[]): void {
    for (const envVar of envVars) {
        if (!process.env[envVar]) {
            throw new Error(`env var ${envVar} not set`);
        }
    }
}

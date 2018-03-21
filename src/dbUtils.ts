import * as aws from "aws-sdk";
import * as mysql from "promise-mysql";

let dbCredentials: {username: string, password: string} = null;

export async function getDbCredentials(): Promise<{username: string, password: string}> {
    if (dbCredentials) {
        return dbCredentials;
    }

    checkForEnvVar("DB_USERNAME_PARAMETER", "DB_PASSWORD_PARAMETER");

    const ssm = new aws.SSM({
        apiVersion: "2014-11-06",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    console.log("fetching db credential parameters");
    const resp = await ssm.getParameters({
        Names: [
            process.env["DB_USERNAME_PARAMETER"],
            process.env["DB_PASSWORD_PARAMETER"]
        ],
        WithDecryption: true
    }).promise();

    if (resp.InvalidParameters && resp.InvalidParameters.length) {
        throw new Error(`Invalid SSM parameters requested: ${resp.InvalidParameters.join(", ")}`);
    }

    return dbCredentials = {
        username: resp.Parameters.find(p => p.Name === process.env["DB_USERNAME_PARAMETER"]).Value,
        password: resp.Parameters.find(p => p.Name === process.env["DB_PASSWORD_PARAMETER"]).Value
    };
}

async function getDbConnection(): Promise<mysql.Connection> {
    checkForEnvVar("DB_ENDPOINT", "DB_PORT");

    const credentials = await getDbCredentials();

    console.log(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
    return await await mysql.createConnection({
        host: process.env["DB_ENDPOINT"],
        port: +process.env["DB_PORT"],
        user: credentials.username,
        password: credentials.password
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

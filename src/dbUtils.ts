import * as aws from "aws-sdk";
import * as mysql from "promise-mysql";
import {SqlDeleteResponse, SqlSelectResponse, SqlUpdateResponse} from "./sqlResponses";
import * as cassava from "cassava";

let dbCredentials: { username: string, password: string } = null;
const isTestEnv = !!process.env["TEST_ENV"];

export async function getDbCredentials(): Promise<{ username: string, password: string }> {
    if (dbCredentials) {
        return dbCredentials;
    }

    if (isTestEnv && process.env["DB_PASSWORD"]) {
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

export async function getDbConnection(): Promise<mysql.Connection> {
    checkForEnvVar("DB_ENDPOINT", "DB_PORT");

    const credentials = await getDbCredentials();

    !isTestEnv && console.log(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
    return await mysql.createConnection({
        host: process.env["DB_ENDPOINT"],
        port: +process.env["DB_PORT"],
        user: credentials.username,
        password: credentials.password,
        database: "rothschild",
        timezone: "Z"
    });
}

export async function getDbReadConnection(): Promise<mysql.Connection> {
    checkForEnvVar("DB_READ_ENDPOINT", "DB_PORT");

    const credentials = await getDbCredentials();

    !isTestEnv && console.log(`connecting to ${process.env["DB_READ_ENDPOINT"]}:${process.env["DB_PORT"]}`);
    return await mysql.createConnection({
        host: process.env["DB_READ_ENDPOINT"],
        port: +process.env["DB_PORT"],
        user: credentials.username,
        password: credentials.password,
        database: "rothschild",
        timezone: "Z"
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

export async function withDbConnection<T>(fxn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
    const conn = await getDbConnection();
    try {
        return await fxn(conn);
    } finally {
        conn.end();
    }
}

export async function withDbReadConnection<T>(fxn: (conn: mysql.Connection) => Promise<T>): Promise<T> {
    const conn = await getDbReadConnection();
    try {
        return await fxn(conn);
    } finally {
        conn.end();
    }
}

export type SqlValue = string | number | Date | any; // added any, otherwise it complains about updating objects like Rule.

export async function withDbConnectionSelectOne<T>(selectQuery: string, values: SqlValue[]): Promise<T> {
    if (!selectQuery || !selectQuery.startsWith("SELECT ")) {
        throw new Error(`Illegal SELECT query '${selectQuery}'.  Must start with 'SELECT '.`);
    }

    return withDbReadConnection<T>(async conn => {
        const res: SqlSelectResponse<T> = await conn.query(selectQuery, values);
        if (res.length === 0) {
            throw new cassava.RestError(404);
        }
        if (res.length > 1) {
            throw new Error(`Illegal SELECT query ${conn.format(selectQuery, values)}.  Returned ${res.length} values.`);
        }
        return res[0];
    });
}

export async function withDbConnectionUpdateOne(updateQuery: string, values: SqlValue[]): Promise<void> {
    if (!updateQuery || !updateQuery.startsWith("UPDATE ")) {
        throw new Error(`Illegal UPDATE query ${updateQuery}.  Must start with 'UPDATE '.`);
    }

    await withDbConnection(async conn => {
        const res: SqlUpdateResponse = await conn.query(updateQuery, values);
        if (res.affectedRows < 1) {
            throw new cassava.RestError(404);
        }
        if (res.affectedRows > 1) {
            throw new Error(`Illegal UPDATE query ${conn.format(updateQuery, values)}.  Changed ${res.affectedRows} values.`);
        }
    });
}

/**
 * Update a row and then select it.  Maybe in the future we can do this with a stored
 * procedure or something?
 */
export async function withDbConnectionUpdateAndFetchOne<T>(updateQuery: string, updateValues: SqlValue[], selectQuery: string, selectValues: SqlValue[]): Promise<T> {
    if (!updateQuery || !updateQuery.startsWith("UPDATE ")) {
        throw new Error(`Illegal UPDATE query ${updateQuery}.  Must start with 'UPDATE '.`);
    }
    if (!selectQuery || !selectQuery.startsWith("SELECT ")) {
        throw new Error(`Illegal SELECT query ${selectQuery}.  Must start with 'SELECT '.`);
    }

    return await withDbConnection(async conn => {
        const updateRes: SqlUpdateResponse = await conn.query(updateQuery, updateValues);
        if (updateRes.affectedRows < 1) {
            throw new cassava.RestError(404);
        }
        if (updateRes.affectedRows > 1) {
            throw new Error(`Illegal UPDATE query ${conn.format(updateQuery, updateValues)}.  Changed ${updateRes.affectedRows} values.`);
        }

        const selectRes: SqlSelectResponse<T> = await conn.query(selectQuery, selectValues);
        if (selectRes.length === 0) {
            throw new cassava.RestError(404);
        }
        if (selectRes.length > 1) {
            throw new Error(`Illegal SELECT query ${conn.format(selectQuery, selectValues)}.  Returned ${selectRes.length} values.`);
        }
        return selectRes[0];
    });
}

export async function withDbConnectionDeleteOne(deleteQuery: string, values: SqlValue[]): Promise<void> {
    if (!deleteQuery || !deleteQuery.startsWith("DELETE FROM ")) {
        throw new Error(`Illegal DELETE query ${deleteQuery}.  Must start with 'DELETE FROM '.`);
    }

    await withDbConnection(async conn => {
        const res: SqlDeleteResponse = await conn.query(deleteQuery, values);
        if (res.affectedRows < 1) {
            throw new cassava.RestError(404);
        }
        if (res.affectedRows > 1) {
            throw new Error(`Illegal DELETE query ${conn.format(deleteQuery, values)}.  Deleted ${res.affectedRows} values.`);
        }
    });
}

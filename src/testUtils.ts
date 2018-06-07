import * as cassava from "cassava";
import * as chai from "chai";
import * as fs from "fs";
import * as mysql from "mysql2/promise";
import * as path from "path";
import {getDbCredentials} from "./dbUtils/connection";
import papaparse = require("papaparse");

if (!process.env["TEST_ENV"]) {
    console.log("Env var TEST_ENV is undefined.  This is not a test environment!");
    throw new Error("Env var TEST_ENV is undefined.  This is not a test environment!");
}

export const defaultTestUser = {
    userId: "default-test-user",
    jwt: "eyJ2ZXIiOjIsInZhdiI6MSwiYWxnIjoiSFMyNTYiLCJ0eXAiOiJKV1QifQ.eyJnIjp7Imd1aSI6InRlc3QtdXNlci1hIiwiZ21pIjoidGVzdC11c2VyLWEifSwiaWF0IjoiMjAxNy0wMy0wN1QxODozNDowNi42MDMrMDAwMCIsImp0aSI6ImJhZGdlLWRkOTViOWI1ODJlODQwZWNiYTFjYmY0MTM2NWQ1N2UxIiwic2NvcGVzIjpbXSwicm9sZXMiOlsiYWNjb3VudE1hbmFnZXIiLCJjb250YWN0TWFuYWdlciIsImN1c3RvbWVyU2VydmljZU1hbmFnZXIiLCJjdXN0b21lclNlcnZpY2VSZXByZXNlbnRhdGl2ZSIsInBvaW50T2ZTYWxlIiwicHJvZ3JhbU1hbmFnZXIiLCJwcm9tb3RlciIsInJlcG9ydGVyIiwic2VjdXJpdHlNYW5hZ2VyIiwidGVhbUFkbWluIiwid2ViUG9ydGFsIl19.Pc1EQL77Z8SsIjlPJqOuVdksx8ZiyFfGwAgFVSOmuMQ"
};

export const alternateTestUser = {
    userId: "alternate-test-user",
    jwt: "eyJ2ZXIiOjIsInZhdiI6MSwiYWxnIjoiSFMyNTYiLCJ0eXAiOiJKV1QifQ.eyJnIjp7Imd1aSI6InRlc3QtdXNlci1iIiwiZ21pIjoidGVzdC11c2VyLWIifSwiaWF0IjoiMjAxOC0wMy0yM1QyMToyNToyNi44MTIrMDAwMCIsImp0aSI6ImJhZGdlLTJmMThmZDI5NmJjZDQ4OGVhZDg1MzU5ZWI2NjgwNDE5Iiwic2NvcGVzIjpbXSwicm9sZXMiOlsiYWNjb3VudE1hbmFnZXIiLCJjb250YWN0TWFuYWdlciIsImN1c3RvbWVyU2VydmljZU1hbmFnZXIiLCJjdXN0b21lclNlcnZpY2VSZXByZXNlbnRhdGl2ZSIsInBvaW50T2ZTYWxlIiwicHJvZ3JhbU1hbmFnZXIiLCJwcm9tb3RlciIsInJlcG9ydGVyIiwic2VjdXJpdHlNYW5hZ2VyIiwidGVhbUFkbWluIiwid2ViUG9ydGFsIl19.yLyfSbgdDoLv4gD9aPkXWB40yj2_vg4WqUnZg6-yNBY"
};

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

        const sqlDir = path.join(__dirname, "lambdas", "postDeploy", "schema");
        for (const sqlFile of fs.readdirSync(sqlDir).sort()) {
            const sql = fs.readFileSync(path.join(sqlDir, sqlFile)).toString("utf8");
            await connection.query(sql);
        }
    } catch (err) {
        console.error("Error setting up DB for test.", err.message, "Fetching InnoDB status...");

        try {
            const [statusRes] = await connection.query("SHOW ENGINE INNODB STATUS");
            if (statusRes.length === 1 && statusRes[0].Status) {
                for (const line of statusRes[0].Status.split("\\n")) {
                    console.error(line);
                }
            }
        } catch (err2) {
            console.error("Error fetching InnoDB status.", err2.message);
        }

        throw err;
    }

    await connection.end();
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

import * as aws from "aws-sdk";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as knex from "knex";
import {Pagination, PaginationParams} from "./model/Pagination";

let dbCredentials: {username: string, password: string} = null;
const isTestEnv = !!process.env["TEST_ENV"];

let knexWriteClient: knex = null;
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
        knexReadClient.queryBuilder = function () {
            const qb = originalQueryBuilder();
            qb.decrement = qb.increment = qb.insert = qb.into = qb.update = () => {
                throw new Error("Attempting to modify database from read-only connection.");
            };
            return qb;
        };
    }

    return knexReadClient;
}

function getKnex(username: string, password: string, endpoint: string, port: string): knex {
    !isTestEnv && console.log(`connecting to ${endpoint}:${port}`);
    return knex({
        client: "mysql2",
        connection: {
            host: endpoint,
            port: +port,
            user: username,
            password: password,
            database: "rothschild",
            timezone: "Z",
            typeCast: function(field, next) {
                if (field.type === "TINY" && field.length === 1) {
                    // MySQL does not have a true boolean type.  Convert tinyint(1) to boolean.
                    return field.string() === "1";
                }
                if (field.type === "DATETIME") {
                    return new Date(field.string() + "Z");
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

/**
 * Get a Date representing now in the same precision as the database.
 */
export function nowInDbPrecision(): Date {
    const now = new Date();
    now.setMilliseconds(0);
    return now;
}

/**
 * update + insert = upsert.
 * This pattern is a MySQL extension.  Knex does not support it natively.
 */
export async function upsert(table: string, update: {[key: string]: any}, insert?: {[key: string]: any}): Promise<[number]> {
    const knex = await getKnexWrite();
    const insertQuery = knex(table).insert(insert || update).toString();
    const updateQuery = knex(table).insert(update).toString();
    const upsertQuery = insertQuery + " on duplicate key update " + updateQuery.replace(/^update [a-z.]+ set /i, "");
    return knex.raw(upsertQuery);
}

/**
 * Apply cursor-based pagination to the given query.  All filtering is supported but sorting (ORDER BY)
 * must be done through PaginationParams.
 */
export async function paginateQuery<T extends {id: string}>(query: knex.QueryBuilder, paginationParams: PaginationParams): Promise<{body: T[], pagination: Pagination}> {
    let reverse = false;
    let atFirst = false;
    let atLast = false;

    if (paginationParams.after) {
        const after = PaginationCursor.decode(paginationParams.after);
        if (after.sort != null && paginationParams.sort) {
            query = query
                .where(query => query
                    .where(paginationParams.sort.field, paginationParams.sort.asc ? ">" : "<", after.sort)
                    .orWhere(query =>
                        query
                            .where(paginationParams.sort.field, "=", after.sort)
                            .where("id", paginationParams.sort.asc ? ">" : "<", after.id)
                    )
                )
                .orderBy(paginationParams.sort.field, paginationParams.sort.asc ? "ASC" : "DESC")
                .orderBy("id", paginationParams.sort.asc ? "ASC" : "DESC");
        } else {
            query = query
                .where("id", ">", after.id)
                .orderBy("id", "ASC");
        }
    } else if (paginationParams.before) {
        const before = PaginationCursor.decode(paginationParams.before);
        if (before.sort != null && paginationParams.sort) {
            query = query
                .where(query => query
                    .where(paginationParams.sort.field, paginationParams.sort.asc ? "<" : ">", before.sort)
                    .orWhere(query =>
                        query
                            .where(paginationParams.sort.field, "=", before.sort)
                            .where("id", paginationParams.sort.asc ? "<" : ">", before.id)
                    )
                )
                .orderBy(paginationParams.sort.field, paginationParams.sort.asc ? "DESC" : "ASC")
                .orderBy("id", paginationParams.sort.asc ? "DESC" : "ASC");
        } else {
            query = query
                .where("id", "<", before.id)
                .orderBy("id", "DESC");
        }
        reverse = true;
    } else if (paginationParams.last) {
        if (paginationParams.sort) {
            query = query
                .orderBy(paginationParams.sort.field, paginationParams.sort.asc ? "DESC" : "ASC")
                .orderBy("id", paginationParams.sort.asc ? "DESC" : "ASC");
        } else {
            query = query
                .orderBy("id", "DESC");
        }
        reverse = true;
        atLast = true;
    } else {
        if (paginationParams.sort) {
            query = query
                .orderBy(paginationParams.sort.field, paginationParams.sort.asc ? "ASC" : "DESC")
                .orderBy("id", paginationParams.sort.asc ? "ASC" : "DESC");
        } else {
            query = query
                .orderBy("id", "ASC");
        }
        atFirst = true;
    }

    query = query.limit(paginationParams.limit);

    const resBody: T[] = await query;
    if (reverse) {
        resBody.reverse();
    }
    if (resBody.length < paginationParams.limit) {
        if (paginationParams.after) {
            atLast = true;
        } else if (paginationParams.before) {
            atFirst = true;
        }
    }

    return {
        body: resBody,
        pagination: {
            limit: paginationParams.limit,
            maxLimit: paginationParams.maxLimit,
            before: !atFirst && resBody.length && PaginationCursor.encode(PaginationCursor.build(true, resBody, paginationParams)),
            after: !atLast && resBody.length && PaginationCursor.encode(PaginationCursor.build(false, resBody, paginationParams))
        }
    };
}

interface PaginationCursor {
    id: string;
    sort?: string | number;
}

namespace PaginationCursor {
    export function build(before: boolean, resBody: any[], paginationParams: PaginationParams): PaginationCursor {
        const ix = before ? 0 : resBody.length - 1;
        let cursor: PaginationCursor = {
            id: resBody[ix].id
        };
        if (paginationParams.sort) {
            cursor.sort = resBody[ix][paginationParams.sort.field];
        }
        return cursor;
    }

    export function decode(s: string): PaginationCursor {
        try {
            return JSON.parse(Buffer.from(s, "base64").toString());
        } catch (unused) {
            throw new giftbitRoutes.GiftbitRestError(400);
        }
    }

    export function encode(c: PaginationCursor): string {
        return Buffer.from(JSON.stringify(c)).toString("base64");
    }
}

/**
 * Get the name of the constraint that failed a consistency check.
 */
export function getSqlErrorConstraintName(err: any): string {
    if (!err.code || !err.sqlMessage) {
        throw new Error("Error is not an SQL error.");
    }
    if (err.code !== "ER_NO_REFERENCED_ROW_2") {
        throw new Error("Error is not a constraint error.");
    }
    const nameMatcher = /Cannot add or update a child row: .* CONSTRAINT `([^`]+)`/.exec(err.sqlMessage);
    if (!nameMatcher) {
        throw new Error("SQL error did not match expected error message despite the correct code 'ER_NO_REFERENCED_ROW_2'.");
    }
    return nameMatcher[1];
}

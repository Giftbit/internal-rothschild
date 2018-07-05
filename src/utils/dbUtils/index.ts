import * as knex from "knex";
import {getKnexWrite} from "./connection";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {filterQuery, FilterQueryOptions} from "./filterQuery";
import {paginateQuery} from "./paginateQuery";

/**
 * Get a Date representing now in the same precision as the database.
 */
export function nowInDbPrecision(): Date {
    return dateInDbPrecision(new Date());
}

/**
 * Convert a Date's precision to same precision as the database.
 */
export function dateInDbPrecision(date: Date): Date {
    date.setMilliseconds(0);
    return date;
}

/**
 * update + insert = upsert.
 * This pattern is a MySQL extension.  Knex does not support it natively.
 */
export async function upsert(table: string, update: { [key: string]: any }, insert?: { [key: string]: any }): Promise<[number]> {
    const knex = await getKnexWrite();
    const insertQuery = knex(table).insert(insert || update).toString();
    const updateQuery = knex(table).insert(update).toString();
    const upsertQuery = insertQuery + " on duplicate key update " + updateQuery.replace(/^update [a-z.]+ set /i, "");
    return knex.raw(upsertQuery);
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

export async function filterAndPaginateQuery<T extends { id: string }>(query: knex.QueryBuilder,
                                                                       filterParams: { [key: string]: string },
                                                                       filterOptions: FilterQueryOptions,
                                                                       paginationParams: PaginationParams): Promise<{ body: T[], pagination: Pagination }> {
    return paginateQuery<T>(
        filterQuery(query, filterParams, filterOptions),
        paginationParams
    );
}

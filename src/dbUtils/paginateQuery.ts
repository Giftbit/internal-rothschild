import * as knex from "knex";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Pagination, PaginationParams} from "../model/Pagination";

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

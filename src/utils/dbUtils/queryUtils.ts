import * as knex from "knex";

export function getPrimaryTableName(query: knex.QueryBuilder) {
    return query.toSQL().sql.match(/`(.*?)`/)[1];
}
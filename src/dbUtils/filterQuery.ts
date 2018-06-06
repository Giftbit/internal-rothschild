import * as knex from "knex";

// TODO
// this is a WIP in progress and not used or tested yet, but feel free to comment on the general approach

export interface FilterQueryOptions {
    properties: {[propertyName: string]: FilterQueryProperty};
}

export interface FilterQueryProperty {
    type: "string" | "number" | "boolean";
    operators?: FilterQueryOperator[];
}

export type FilterQueryOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "ne" |  "like";

export function filterQuery(query: knex.QueryBuilder, filterParams: {[key: string]: string}, options: FilterQueryOptions): knex.QueryBuilder {
    for (const filterKey of Object.keys(query)) {
        if (filterKey.indexOf(".") !== -1) {
            const keyAndOp = filterKey.split(".");
            if (keyAndOp.length === 2 && options.properties.hasOwnProperty(keyAndOp[0]) && filterQueryPropertyAllowsOperator(options.properties[keyAndOp[0]], keyAndOp[1] as FilterQueryOperator)) {
                query = addToQuery(query, options.properties[keyAndOp[0]], keyAndOp[0], keyAndOp[1] as FilterQueryOperator, filterParams[keyAndOp[0]]);
            }
        } else if (options.properties.hasOwnProperty(filterKey)) {
            if (filterQueryPropertyAllowsOperator(options.properties[filterKey])) {
                query = addToQuery(query, options.properties[filterKey], filterKey, "eq", filterParams[filterKey]);
            }
        }
    }

    return query;
}

const defaultOperators: FilterQueryOperator[] = ["lt", "lte", "gt", "gte", "eq", "ne"];

function filterQueryPropertyAllowsOperator(prop: FilterQueryProperty, op: FilterQueryOperator = "eq"): boolean {
    return prop.operators ? prop.operators.indexOf(op) !== -1 : defaultOperators.indexOf(op) !== -1;
}

function addToQuery(query: knex.QueryBuilder, prop: FilterQueryProperty, key: string, op: FilterQueryOperator, value: string): knex.QueryBuilder {
    let convertedValue: number | string | boolean;
    if (prop.type === "number") {
        convertedValue = +value;
    } else if (prop.type === "boolean") {
        convertedValue = value.toLowerCase() === "true";
    } else {
        convertedValue = value;
    }

    switch (op) {
        case "lt": return query.where(key, "<", convertedValue);
        case "lte": return query.where(key, "<=", convertedValue);
        case "gt": return query.where(key, ">", convertedValue);
        case "gte": return query.where(key, ">=", convertedValue);
        case "eq": return query.where(key, "=", convertedValue);
        case "ne": return query.where(key, "!=", convertedValue);
        case "like": return query.where(key, "LIKE", convertedValue);
    }
}

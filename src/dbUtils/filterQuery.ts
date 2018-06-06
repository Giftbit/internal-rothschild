import * as knex from "knex";
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface FilterQueryOptions {
    properties: {[propertyName: string]: FilterQueryProperty};
}

export interface FilterQueryProperty {
    type: "string" | "number" | "boolean" | "Date";
    operators?: FilterQueryOperator[];
}

export type FilterQueryOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "ne" |  "like";

export function filterQuery(query: knex.QueryBuilder, filterParams: {[key: string]: string}, options: FilterQueryOptions): knex.QueryBuilder {
    for (const filterKey of Object.keys(filterParams)) {
        if (filterKey.indexOf(".") !== -1) {
            const keyAndOp = filterKey.split(".");
            if (keyAndOp.length === 2 && options.properties.hasOwnProperty(keyAndOp[0]) && filterQueryPropertyAllowsOperator(options.properties[keyAndOp[0]], keyAndOp[1] as FilterQueryOperator)) {
                query = addToQuery(
                    query,
                    options.properties[keyAndOp[0]],
                    keyAndOp[0],
                    keyAndOp[1] as FilterQueryOperator,
                    filterParams[filterKey]
                );
            }
        } else if (options.properties.hasOwnProperty(filterKey)) {
            if (filterQueryPropertyAllowsOperator(options.properties[filterKey])) {
                query = addToQuery(
                    query,
                    options.properties[filterKey],
                    filterKey,
                    "eq",
                    filterParams[filterKey]
                );
            }
        }
    }

    return query;
}

function filterQueryPropertyAllowsOperator(prop: FilterQueryProperty, op: FilterQueryOperator = "eq"): boolean {
    if (prop.operators) {
        return prop.operators.indexOf(op) !== -1;
    }
    switch (prop.type) {
        case "boolean":
            return ["eq", "ne"].indexOf(op) !== -1;
        case "number":
        case "Date":
            return ["lt", "lte", "gt", "gte", "eq", "ne"].indexOf(op) !== -1;
        case "string":
            return ["lt", "lte", "gt", "gte", "eq", "ne", "like"].indexOf(op) !== -1;
    }
}

function addToQuery(query: knex.QueryBuilder, prop: FilterQueryProperty, key: string, op: FilterQueryOperator, value: string): knex.QueryBuilder {
    let convertedValue: number | string | boolean | Date;
    switch (prop.type) {
        case "number":
            convertedValue = +value;
            if (isNaN(convertedValue)) {
                throw new giftbitRoutes.GiftbitRestError(400, `Query filter ${key}=${value} value could not be parsed as a number.`);
            }
            break;
        case "boolean":
            convertedValue = value.toLowerCase() === "true";
            break;
        case "Date":
            convertedValue = new Date(value);
            if (isNaN(convertedValue.getTime())) {
                throw new giftbitRoutes.GiftbitRestError(400, `Query filter ${key}=${value} value could not be parsed as an ISO Date.`);
            }
            break;
        case "string":
        default:
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

import * as knex from "knex";
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface FilterQueryOptions {
    properties: {[propertyName: string]: FilterQueryProperty};
}

/**
 * Specifies what properties from the query string act as filters.
 */
export interface FilterQueryProperty {
    /**
     * The type controls parsing the property and default set of operators available.
     */
    type: "string" | "number" | "boolean" | "Date";

    /**
     * The column name that is filtered.  By default the column name is the query parameter name.
     */
    columnName?: string;

    // TODO when tagging is a thing this will need to support searching for the IDs matching the tags in another table

    /**
     * Override the operators available for this property.
     */
    operators?: FilterQueryOperator[];
}

export type FilterQueryOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "ne" | "in" | "like";

/**
 * Add where clauses to filter the given SQL query.
 * @param query The SQL query to filter.
 * @param filterParams A map of string filter values.  Most likely the URL query.
 * @param options Specifies the filterable values.
 * @returns The filtered SQL query.
 */
export function filterQuery(query: knex.QueryBuilder, filterParams: {[key: string]: string}, options: FilterQueryOptions): knex.QueryBuilder {
    for (let filterKey of Object.keys(filterParams)) {
        const filterValue = filterParams[filterKey];
        let op: string = "eq";
        if (filterKey.indexOf(".") !== -1) {
            const keyAndOp = filterKey.split(".", 2);
            filterKey = keyAndOp[0];
            op = keyAndOp[1];
        }

        if (!options.properties.hasOwnProperty(filterKey)) {
            // Not a filterable property.
            continue;
        }

        const property = options.properties[filterKey];
        if (!filterQueryPropertyAllowsOperator(property, op)) {
            throw new giftbitRoutes.GiftbitRestError(400, `Query filter key '${filterKey}' does not support operator '${op}'.`);
        }

        query = addFilterToQuery(
            query,
            property,
            filterKey,
            op,
            filterValue
        );
    }

    return query;
}

function filterQueryPropertyAllowsOperator(prop: FilterQueryProperty, op: string): op is FilterQueryOperator {
    if (prop.operators) {
        return prop.operators.indexOf(op as FilterQueryOperator) !== -1;
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
    return false;
}

function addFilterToQuery(query: knex.QueryBuilder, prop: FilterQueryProperty, key: string, op: FilterQueryOperator, value: string): knex.QueryBuilder {
    let columnName = key;
    if (prop.columnName) {
        columnName = prop.columnName;
    }

    switch (op) {
        case "lt": return query.where(columnName, "<", convertValue(prop, value));
        case "lte": return query.where(columnName, "<=", convertValue(prop, value));
        case "gt": return query.where(columnName, ">", convertValue(prop, value));
        case "gte": return query.where(columnName, ">=", convertValue(prop, value));
        case "eq": return query.where(columnName, "=", convertValue(prop, value));
        case "ne": return query.where(columnName, "!=", convertValue(prop, value));
        case "in": return query.whereIn(columnName, value.split(",").map(v => convertValue(prop, v)));
        case "like": return query.where(columnName, "LIKE", convertValue(prop, value));
    }
}

function convertValue(prop: FilterQueryProperty, value: string): number | string | boolean | Date {
    switch (prop.type) {
        case "number":
            const numValue = +value;
            if (isNaN(numValue)) {
                throw new giftbitRoutes.GiftbitRestError(400, `Query filter value '${value}' could not be parsed as a number.`);
            }
            return numValue;
        case "boolean":
            return value.toLowerCase() === "true";
        case "Date":
            const dateValue = new Date(value);
            if (isNaN(dateValue.getTime())) {
                throw new giftbitRoutes.GiftbitRestError(400, `Query filter value '${value}' could not be parsed as an ISO Date.`);
            }
            return dateValue;
        case "string":
        default:
            return value;
    }
}

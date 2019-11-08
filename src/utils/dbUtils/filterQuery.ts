import * as knex from "knex";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {QueryOptions} from "./QueryOptions";

export interface FilterQueryOptions extends QueryOptions {
    properties: { [propertyName: string]: FilterQueryProperty };
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

    /**
     * Maps the value passed in through the query param to a value that will
     * be used in the SQL query.  The type of the value passed in will match the
     * `type` property of this object.  The type of the value returned by
     * this function must match the SQL column type.
     */
    valueMap?: (value: any) => number | string | boolean | Date | Promise<number | string | boolean | Date>;
}

export type FilterQueryOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "ne" | "in" | "like" | "isNull";

/**
 * Add where clauses to filter the given SQL query.
 * @param query The SQL query to filter.
 * @param filterParams A map of string filter values.  Most likely the URL query.
 * @param options Specifies the filterable values.
 * @returns The filtered SQL query in a tuple.
 */
export async function filterQuery(query: knex.QueryBuilder, filterParams: { [key: string]: string }, options: FilterQueryOptions): Promise<[knex.QueryBuilder]> {
    for (const queryKey of Object.keys(filterParams)) {
        const {filterKey, op} = splitFilterKeyAndOp(queryKey);
        const filterValue = filterParams[queryKey];

        if (!options.properties.hasOwnProperty(filterKey)) {
            // Not a filterable property.
            continue;
        }

        const property = options.properties[filterKey];
        if (!filterQueryPropertyAllowsOperator(property, op)) {
            throw new giftbitRoutes.GiftbitRestError(400, `Query filter key '${filterKey}' does not support operator '${op}'.`);
        }

        [query] = await addFilterToQuery(
            query,
            property,
            filterKey,
            op,
            filterValue,
            options
        );
    }

    // We have to return the query in an array (or object or something) because the query is
    // itself awaitable so awaiting this function would execute the query.
    return [query];
}

function splitFilterKeyAndOp(filterKey: string): { filterKey: string, op: string } {
    let op: string = "eq";
    if (filterKey.indexOf(".") !== -1) {
        const keyAndOp = filterKey.split(".", 2);
        filterKey = keyAndOp[0];
        op = keyAndOp[1];
    }
    return {filterKey, op};
}

function filterQueryPropertyAllowsOperator(prop: FilterQueryProperty, op: string): op is FilterQueryOperator {
    if (prop.operators) {
        return prop.operators.indexOf(op as FilterQueryOperator) !== -1;
    }
    switch (prop.type) {
        case "boolean":
            return ["eq", "ne", "isNull"].indexOf(op) !== -1;
        case "number":
        case "Date":
            return ["lt", "lte", "gt", "gte", "eq", "ne", "isNull"].indexOf(op) !== -1;
        case "string":
            return ["lt", "lte", "gt", "gte", "eq", "ne", "like", "isNull"].indexOf(op) !== -1;
    }
    return false;
}

async function addFilterToQuery(query: knex.QueryBuilder, prop: FilterQueryProperty, key: string, op: FilterQueryOperator, value: string, options: FilterQueryOptions): Promise<[knex.QueryBuilder]> {
    let columnIdentifier = key;
    if (prop.columnName) {
        columnIdentifier = prop.columnName;
    }
    if (options.tableName) {
        columnIdentifier = options.tableName + "." + columnIdentifier;
    }

    switch (op) {
        case "lt":
            return [query.where(columnIdentifier, "<", await convertValue(prop, value))];
        case "lte":
            return [query.where(columnIdentifier, "<=", await convertValue(prop, value))];
        case "gt":
            return [query.where(columnIdentifier, ">", await convertValue(prop, value))];
        case "gte":
            return [query.where(columnIdentifier, ">=", await convertValue(prop, value))];
        case "eq":
            return [query.where(columnIdentifier, "=", await convertValue(prop, value))];
        case "ne":
            return [query.where(columnIdentifier, "!=", await convertValue(prop, value))];
        case "in":
            return [query.whereIn(columnIdentifier, await Promise.all(value.split(",").map(v => convertValue(prop, v))))];
        case "like":
            return [query.where(columnIdentifier, "LIKE", await convertValue(prop, value))];
        case "isNull":
            switch (value) {
                case "true":
                    return [query.whereNull(columnIdentifier)];
                case "false":
                    return [query.whereNotNull(columnIdentifier)];
                default:
                    throw new giftbitRoutes.GiftbitRestError(422, `Query filter '${value}' is not allowed on isNull operator. Allowed values [true, false].`)
            }
    }
}

async function convertValue(prop: FilterQueryProperty, value: string): Promise<number | string | boolean | Date> {
    let result: number | string | boolean | Date;
    switch (prop.type) {
        case "number":
            const numValue = +value;
            if (isNaN(numValue)) {
                throw new giftbitRoutes.GiftbitRestError(400, `Query filter value '${value}' could not be parsed as a number.`);
            }
            result = numValue;
            break;
        case "boolean":
            result = value.toLowerCase() === "true";
            break;
        case "Date":
            const dateValue = new Date(value);
            if (isNaN(dateValue.getTime())) {
                throw new giftbitRoutes.GiftbitRestError(400, `Query filter value '${value}' could not be parsed as an ISO Date.`);
            }
            result = dateValue;
            break;
        case "string":
        default:
            result = value;
            break;
    }
    if (prop.valueMap) {
        result = await prop.valueMap(result);
    }
    return result;
}

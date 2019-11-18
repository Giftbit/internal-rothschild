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

export type FilterQueryOperator = "lt" | "lte" | "gt" | "gte" | "eq" | "ne" | "in" | "like" | "isNull" | "orNull";

type FilterValueType = number | string | boolean | Date

type Filter = SingleValueFilter | ArrayValueFilter;

interface BasicFilterProps {
    property: FilterQueryProperty;
    filterKey: string;
    op: FilterQueryOperator;
}

/**
 * The Value is singular. Ie `property.op=value`.
 */
interface SingleValueFilter extends BasicFilterProps {
    value: FilterValueType
}

/**
 * The Value is an array. Ie `property.in=value1,value2`.
 */
interface ArrayValueFilter extends BasicFilterProps {
    value: FilterValueType[]
}


/**
 * Add where clauses to filter the given SQL query.
 * @param query The SQL query to filter.
 * @param filterParams A map of string filter values.  Most likely the URL query.
 * @param options Specifies the filterable values.
 * @returns The filtered SQL query in a tuple.
 */
export async function filterQuery(query: knex.QueryBuilder, filterParams: { [key: string]: string }, options: FilterQueryOptions): Promise<[knex.QueryBuilder]> {
    const filters: Filter[] = [];
    const orNullFilters: Filter[] = [];
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

        // value: op !== "in" ? await convertValue(property, filterValue, op) :
        //                 await Promise.all(filterValue.split(",").map(v => convertValue(property, v, op)))

        const filter: Filter = {
            property: property,
            filterKey: filterKey,
            op: op,
            value: op !== "in" ? await convertValue(property, filterValue, op) :
                await Promise.all(filterValue.split(",").map(v => convertValue(property, v, op)))
        } as Filter;

        // if (op !== "in") {
        //     filter = {
        //         property: property,
        //         filterKey: filterKey,
        //         op: op,
        //         value: await convertValue(property, filterValue, op)
        //     }
        // } else {
        //     filter = {
        //         property: property,
        //         filterKey: filterKey,
        //         op: op,
        //         value: await Promise.all(filterValue.split(",").map(v => convertValue(property, v, op)))
        //     }
        // }

        if (filter.op === "orNull") {
            orNullFilters.push(filter);
        } else {
            filters.push(filter);
        }
    }

    query = addFiltersToQuery(query, filters, orNullFilters, options);

    // We have to return the query in an array (or object or something) because the query is
    // itself awaitable so awaiting this function would execute the query.
    return [query];
}

function addFiltersToQuery(query: knex.QueryBuilder, filters: Filter[], orNullFilters: Filter[], options: FilterQueryOptions): knex.QueryBuilder {
    for (const filter of filters) {
        const orNullFilter = orNullFilters.find(orNullFilter => orNullFilter.filterKey === filter.filterKey);
        if (orNullFilter) {
            query.where(q => {
                q = addFilterToQuery(q, filter, options);
                q = addFilterToQuery(q, orNullFilter, options);
                return q;
            });
        } else {
            query = addFilterToQuery(
                query,
                filter,
                options
            );
        }
    }
    return query;
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
            return ["eq", "ne", "isNull", "orNull"].indexOf(op) !== -1;
        case "number":
        case "Date":
            return ["lt", "lte", "gt", "gte", "eq", "ne", "isNull", "orNull"].indexOf(op) !== -1;
        case "string":
            return ["lt", "lte", "gt", "gte", "eq", "ne", "like", "isNull", "orNull"].indexOf(op) !== -1;
    }
    return false;
}

function addFilterToQuery(query: knex.QueryBuilder, filter: SingleValueFilter | ArrayValueFilter, options: FilterQueryOptions): knex.QueryBuilder {
    let columnIdentifier = filter.filterKey;
    if (filter.property.columnName) {
        columnIdentifier = filter.property.columnName;
    }
    if (options.tableName) {
        columnIdentifier = options.tableName + "." + columnIdentifier;
    }

    switch (filter.op) {
        case "lt":
            return query.where(columnIdentifier, "<", filter.value);
        case "lte":
            return query.where(columnIdentifier, "<=", filter.value);
        case "gt":
            return query.where(columnIdentifier, ">", filter.value);
        case "gte":
            return query.where(columnIdentifier, ">=", filter.value);
        case "eq":
            return query.where(columnIdentifier, "=", filter.value);
        case "ne":
            return query.where(columnIdentifier, "!=", filter.value as FilterValueType);
        case "in":
            return query.whereIn(columnIdentifier, filter.value as FilterValueType[]);
        case "like":
            return query.where(columnIdentifier, "LIKE", filter.value as FilterValueType);
        case "isNull":
            if (filter.value) {
                return query.whereNull(columnIdentifier);
            } else {
                return query.whereNotNull(columnIdentifier);
            }
        case "orNull":
            if (filter.value) {
                query.orWhereNull(columnIdentifier);
            } else {
                query.orWhereNotNull(columnIdentifier);
            }
    }
}

async function convertValue(prop: FilterQueryProperty, value: string, operator: FilterQueryOperator): Promise<number | string | boolean | Date> {
    if (operator === "orNull" || operator === "isNull") {
        switch (value) {
            case "true":
                return true;
            case "false":
                return false;
            default:
                throw new giftbitRoutes.GiftbitRestError(422, `Query filter '${value}' is not allowed on ${operator} operator. Allowed values [true, false].`)
        }
    }
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

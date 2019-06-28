import * as cassava from "cassava";
import * as querystring from "querystring";
import {RouterEvent} from "cassava/dist/RouterEvent";
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface PaginationParams {
    limit: number;
    maxLimit: number;
    sort: {
        field: string;
        asc: boolean;
    } | null;
    before: string | null;
    after: string | null;
    last: boolean;
}

export interface PaginationParamOptions {
    defaultLimit?: number;
    maxLimit?: number;
    sort?: {
        field: string;
        asc: boolean;
    };
}

export class Pagination {
    limit: number;
    maxLimit: number;
    before: string | null;
    after: string | null;
}

export namespace Pagination {
    export function toHeaders(evt: cassava.RouterEvent, pagination: Pagination): { [key: string]: string } {
        const resQueryParams = {...evt.queryStringParameters};
        delete resQueryParams.after;
        delete resQueryParams.before;
        delete resQueryParams.last;

        // Link header corresponding to https://tools.ietf.org/html/rfc5988
        let link: string = "";
        if (pagination.before) {
            link = toLink(evt.path, resQueryParams, "first") + "," + toLink(evt.path, {
                ...resQueryParams,
                before: pagination.before
            }, "prev");
        }
        if (pagination.after) {
            if (link) {
                link += ",";
            }
            link += toLink(evt.path, {
                ...resQueryParams,
                after: pagination.after
            }, "next") + "," + toLink(evt.path, {...resQueryParams, last: "true"}, "last");
        }

        return {
            "Limit": pagination.limit.toString(),
            "Max-Limit": pagination.maxLimit.toString(),
            "Link": link
        };
    }

    function toLink(path: string, queryString: { [key: string]: string }, rel: string): string {
        return `<${path}?${querystring.stringify(queryString)}>; rel="${encodeURIComponent(rel)}"`;
    }

    export function getPaginationParams(evt: RouterEvent, options?: PaginationParamOptions): PaginationParams {
        const defaultLimit = options && options.defaultLimit || 100;
        const maxLimit = options && options.maxLimit || evt.headers["Accept"] === "text/csv" ? 10000 : 1000;
        const defaultSort = {
            field: "createdDate",
            asc: false
        };

        return {
            limit: Math.min(Math.max(+evt.queryStringParameters["limit"] || defaultLimit, 1), maxLimit),
            maxLimit,
            sort: options && options.sort || defaultSort,
            before: evt.queryStringParameters.before,
            after: evt.queryStringParameters.after,
            last: (evt.queryStringParameters.last || "").toLowerCase() === "true"
        };
    }

    export function getPaginationParamsForReports(evt: RouterEvent, options: PaginationParamOptions): PaginationParams {
        const defaultSort = {field: "createdDate", asc: false};
        const maxLimit = options && options.maxLimit || 10000;

        if (+evt.queryStringParameters["limit"] && +evt.queryStringParameters["limit"] > maxLimit) {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested limit '${+evt.queryStringParameters["limit"]}' is greater than maxLimit '${maxLimit}'. Please modify your request and try again.`);
        }

        return {
            limit: (isNaN(+evt.queryStringParameters["limit"]) ? maxLimit : Math.min(+evt.queryStringParameters["limit"], maxLimit)) + 1, // +1 so that we can optionally throw an error if query result is greater than the requested limit
            maxLimit: maxLimit + 1, // +1 so that we can optionally throw an error if query result is greater than the requested limit
            sort: options && options.sort || defaultSort,
            before: null,
            after: null,
            last: null
        };
    }
}

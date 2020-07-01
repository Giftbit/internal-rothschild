import * as cassava from "cassava";
import * as querystring from "querystring";
import {RouterEvent} from "cassava/dist/RouterEvent";

/**
 * Controls pagination.  This is a combination of values passed in
 * by the user and our own settings.
 * @see getPaginationParams
 */
export interface PaginationParams {
    /**
     * The maximum number of items to get (page size).
     */
    limit: number;

    /**
     * The highest the limit can be.
     */
    maxLimit: number;

    /**
     * How rows are sorted.
     */
    sort: {
        field: string;
        asc: boolean;
    } | null;

    /**
     * A token returned from a previous paginated call to get the previous page.
     */
    before: string | null;

    /**
     * A token returned from a previous paginated call to get the next page.
     */
    after: string | null;

    /**
     * Whether to get the last page.  Has no effect if `before` or `after` are specified.
     */
    last: boolean;
}

/**
 * Controls
 */
export interface PaginationParamOptions {
    /**
     * The default limit a user will get if none is specified.
     */
    defaultLimit?: number;

    /**
     * The maximum limit a user can ask for.
     */
    maxLimit?: number;

    /**
     * Override how rows are sorted.
     */
    sort?: {
        field: string;
        asc: boolean;
    };
}

/**
 * Information about paginated results.
 */
export class Pagination {
    /**
     * The limit that was used.
     */
    limit: number;

    /**
     * The maximum limit that can be used.
     */
    maxLimit: number;

    /**
     * A token that can be passed back in as a PaginationParam to get
     * the page of results before this one.
     */
    before: string | null;

    /**
     * A token that can be passed back in as a PaginationParam to get
     * the page after this one.
     */
    after: string | null;
}

export namespace Pagination {
    export function toHeaders(evt: cassava.RouterEvent, pagination: Pagination): { [key: string]: string } {
        const resQueryParams = {...evt.queryStringParameters};
        delete resQueryParams.after;
        delete resQueryParams.before;
        delete resQueryParams.last;

        // Link header corresponding to https://tools.ietf.org/html/rfc5988
        let link = "";
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

    /**
     * Get a PaginationParams object from the request query parameters.
     * PaginationParamOptions controls legals values.
     */
    export function getPaginationParams(evt: RouterEvent, options?: PaginationParamOptions): PaginationParams {
        const defaultLimit = options && options.defaultLimit || 100;
        const maxLimit = (options && options.maxLimit) || (evt.headers["Accept"] === "text/csv" ? 10000 : 1000);
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
}

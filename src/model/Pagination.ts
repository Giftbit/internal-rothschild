import * as cassava from "cassava";
import * as querystring from "querystring";
import {RouterEvent} from "cassava/dist/RouterEvent";

export interface PaginationParams {
    limit: number;
    maxLimit: number;
    before: string;
    after: string;
    last: boolean;
}

export class Pagination {
    limit: number;
    maxLimit: number;
    before: string;
    after: string;
}

export namespace Pagination {
    export function toHeaders(evt: cassava.RouterEvent, pagination: Pagination): { [key: string]: string } {
        const resQueryParams = {...evt.queryStringParameters};
        delete resQueryParams.after;
        delete resQueryParams.before;
        delete resQueryParams.last;

        let link: string;
        if (!pagination.before) {
            link = toLink(evt.path, resQueryParams, "first") + "," + toLink(evt.path, {...resQueryParams, before: pagination.before}, "prev");
        }
        if (!pagination.after) {
            if (link.length > 0) {
                link += ",";
            }
            link += toLink(evt.path, {...resQueryParams, after: pagination.after}, "next") + "," + toLink(evt.path, {...resQueryParams, last: "true"}, "last");
        }

        return {
            Limit: pagination.limit.toString(),
            MaxLimit: pagination.maxLimit.toString(),
            Link: link
        };
    }

    function toLink(path: string, queryString: {[key: string]: string}, rel: string): string {
        return `<${path}?${querystring.stringify(queryString)}>; rel="${encodeURIComponent(rel)}"`;
    }

    export function getPaginationParams(evt: RouterEvent, defaultLimit: number = 100, maxLimit: number = 1000): PaginationParams {
        return {
            limit: Math.min(Math.max(+evt.queryStringParameters["limit"] || 100, 1), maxLimit),
            maxLimit,
            before: evt.queryStringParameters.before,
            after: evt.queryStringParameters.after,
            last: (evt.queryStringParameters.last || "").toLowerCase() === "true"
        };
    }
}

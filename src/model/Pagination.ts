import {RouterEvent} from "cassava/dist/RouterEvent";

export interface PaginationParams {
    limit: number;
    maxLimit: number;
    offset: number;
}

export class Pagination {
    limit: number;
    maxLimit: number;
    offset: number;
    totalCount?: number;
}

export namespace Pagination {
    export function toHeaders(pagination: Pagination): { [key: string]: string } {
        return {
            Limit: pagination.limit.toString(),
            MaxLimit: pagination.maxLimit.toString(),
            Offset: pagination.offset.toString()
        };
    }

    export function getPaginationParams(evt: RouterEvent, defaultLimit: number = 100, maxLimit: number = 1000): PaginationParams {
        return {
            limit: Math.min(Math.max(+evt.queryStringParameters["limit"] || 100, 1), maxLimit),
            maxLimit,
            offset: Math.max(+evt.queryStringParameters["offset"] || 0, 0)
        };
    }
}

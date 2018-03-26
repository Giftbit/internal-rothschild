import {RouterEvent} from "cassava/dist/RouterEvent";

export interface PaginationParams {
    limit: number;
    maxLimit: number;
    offset: number;
}

export interface Pagination {
    count: number;
    limit: number;
    maxLimit: number;
    offset: number;
    totalCount?: number;
}

export function getPaginationParams(evt: RouterEvent, defaultLimit: number = 100, maxLimit: number = 1000): PaginationParams {
    return {
        limit: Math.min(Math.max(+evt.queryStringParameters["limit"] || 100, 1), maxLimit),
        maxLimit,
        offset: Math.max(+evt.queryStringParameters["offset"] || 0, 0)
    };
}

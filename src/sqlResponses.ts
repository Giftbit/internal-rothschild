export type SqlSelectResponse<T> = Array<T>;

export interface SqlDeleteResponse extends SqlUpdateResponse {}

export interface SqlInsertResponse extends SqlUpdateResponse {}

export interface SqlUpdateResponse {
    fieldCount: number;
    affectedRows: number;
    insertId: number;
    serverStatus: number;
    warningCount: number;
    message: string;
    protocol41: boolean;
    changedRows: number;
}

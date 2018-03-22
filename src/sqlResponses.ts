export interface SqlInsertResponse extends SqlUpdateResponse {}

export interface SqlUpdateResponse {
    fieldCOunt: number;
    affectedRows: number;
    insertId: number;
    serverStatus: number;
    warningCount: number;
    message: string;
    protocol41: boolean;
    changedRows: number;
}

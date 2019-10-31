export interface ParsedCsvProxyResponse<T> {
    statusCode: number;
    headers: {
        [key: string]: string;
    };
    body: T[];
    bodyRaw: string;
}

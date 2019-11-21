export interface BinlogTransaction {
    statements: BinlogTransaction.Statement[];
    nextPosition: number;
    binlogName: string;
}

export namespace BinlogTransaction {
    export interface Statement {
        type: "INSERT" | "UPDATE" | "DELETE";
        schema: string;
        table: string;
        affectedRows: { before: [], after: any }[];
        affectedColumns: string[];
        timestamp: number;
        nextPosition: number;
        binlogName: string;
    }
}

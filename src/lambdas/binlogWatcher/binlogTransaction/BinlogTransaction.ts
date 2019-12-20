/**
 * An entire SQL transaction in the MySQL binlog.  A transaction is
 * made up of one or more statements.  All statements in the transaction
 * happen in the order given.
 */
export interface BinlogTransaction {
    statements: BinlogTransaction.Statement<any>[];
    nextPosition: number;
    binlogName: string;
}

export namespace BinlogTransaction {
    export interface Statement<T> {
        type: "INSERT" | "UPDATE" | "DELETE";
        schema: string;
        table: string;
        affectedRows: AffectedRow<T>[];
        affectedColumns: string[];
        timestamp: number;
        nextPosition: number;
    }

    export interface AffectedRow<T> {
        before: T;
        after: T;
    }
}

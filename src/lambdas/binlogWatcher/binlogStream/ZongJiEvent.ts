/**
 * Properties common to all ZongJi events.
 */
export interface ZongJiEventBase {
    nextPosition: number;
    size: number;
    timestamp: number;
}

export interface FormatEvent extends ZongJiEventBase {
    getEventName(): "format";

    getTypeName(): "Format";
}

export interface DeleteRowsEvent extends ZongJiEventBase {
    getEventName(): "deleterows";

    getTypeName(): "DeleteRows";
}

/**
 * @see https://dev.mysql.com/doc/internals/en/query-event.html
 */
export interface QueryEvent extends ZongJiEventBase {
    getEventName(): "query";

    getTypeName(): "Query";

    slaveProxyId: number;
    executionTime: number;
    schemaLength: number;
    errorCode: number;
    statusVarsLength: number;
    statusVars: string;
    schema: string;
    query: string;
}

/**
 * A new binlog file was created.
 * @see https://dev.mysql.com/doc/internals/en/rotate-event.html
 */
export interface RotateEvent extends ZongJiEventBase {
    getEventName(): "rotate";

    getTypeName(): "Rotate";

    binlogName: string;
    position: number;
}

export interface TableMap {
    [key: string]: {
        columnSchemas: {
            [key: string]: {
                COLUMN_NAME: string;
                COLLATION_NAME: string | null;
                CHARACTER_SET_NAME: string | null;
                COLUMN_COMMENT: string;
                COLUMN_TYPE: string;
            }
        };
        parentSchema: string;
        tableName: string;
        columns: {
            name: string;
            charset: string;
            type: number;
            metadata: {
                max_length?: number;
                decimals?: number;
            }
        }[];
    };
}

export interface TableMapEvent {
    getEventName(): "tablemap";

    getTypeName(): "TableMap";

    tableMap: TableMap;
    tableId: number;
    flags: number;
    schemaName: string;
    tableName: string;
    columnCount: number;
    columnTypes: number[];
    columnsMetadata: ({
        max_length?: number;
        decimals?: number;
    } | null)[];
}

export interface UpdateRowsEvent extends ZongJiEventBase {
    getEventName(): "updaterows";

    getTypeName(): "UpdateRows";
}

export interface WriteRowsEvent extends ZongJiEventBase {
    getEventName(): "writerows";

    getTypeName(): "WriteRows";

    tableId: number;
    flags: number;
    useChecksum: boolean;
    extraDataLength: number;
    numberOfColumns: number;
    tableMap: TableMap;
    columns_present_bitmap: Buffer;
    rows: { [key: string]: string | number | boolean | Date | null }[];
}

/**
 * @see https://dev.mysql.com/doc/internals/en/xid-event.html
 */
export interface XidEvent extends ZongJiEventBase {
    getEventName(): "xid";

    getTypeName(): "Xid";

    xid: number;
}

/**
 * A row in the MySQL binary log as represented by ZongJi.
 * @see https://github.com/nevill/zongji
 * @see https://dev.mysql.com/doc/internals/en/event-meanings.html
 */
export type ZongJiEvent =
    FormatEvent
    | DeleteRowsEvent
    | QueryEvent
    | RotateEvent
    | UpdateRowsEvent
    | WriteRowsEvent
    | XidEvent;

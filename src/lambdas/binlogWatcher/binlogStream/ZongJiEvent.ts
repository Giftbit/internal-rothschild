/**
 * Properties common to all ZongJi events.
 */
export interface ZongJiEventBase {
    nextPosition: number;
    size: number;
    timestamp: number;
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
}

export interface UpdateRowsEvent extends ZongJiEventBase {
    getEventName(): "updaterows";

    getTypeName(): "UpdateRows";
}

export interface WriteRowsEvent extends ZongJiEventBase {
    getEventName(): "writerows";

    getTypeName(): "WriteRows";
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
export type ZongJiEvent = DeleteRowsEvent | QueryEvent | RotateEvent | UpdateRowsEvent | WriteRowsEvent | XidEvent;

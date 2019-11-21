export interface ZongJiEventBase {
    nextPosition: number;
    size: number;
    timestamp: number;
}

export interface DeleteRowsEvent extends ZongJiEventBase {
    getEventName(): "deleterows";

    getTypeName(): "DeleteRows";
}

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

export interface XidEvent extends ZongJiEventBase {
    getEventName(): "xid";

    getTypeName(): "Xid";

    xid: number;
}

export type ZongJiEvent = DeleteRowsEvent | QueryEvent | RotateEvent | UpdateRowsEvent | WriteRowsEvent | XidEvent;

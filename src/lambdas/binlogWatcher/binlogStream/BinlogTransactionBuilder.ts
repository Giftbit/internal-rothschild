import EventEmitter = require("events");
import log = require("loglevel");
import {mysqlEventDataNormalizer} from "./mysqlEventDataNormalizer";
import {
    DeleteRowsEvent,
    QueryEvent,
    RotateEvent,
    UpdateRowsEvent,
    WriteRowsEvent,
    XidEvent,
    ZongJiEvent
} from "./ZongJiEvent";
import {BinlogTransaction} from "../BinlogTransaction";

export class BinlogTransactionBuilder extends EventEmitter {

    private binlogName: string = null;
    private txInProgress: BinlogTransaction = null;

    reset(binlogName: string): void {
        this.txInProgress = null;
        this.binlogName = binlogName;
    }

    handleBinlogEvent(event: ZongJiEvent): void {
        switch (event.getTypeName()) {
            case "Query":
                this.handleQueryEvent(event as QueryEvent);
                break;
            case "Rotate":
                this.handleRotateEvent(event as RotateEvent);
                break;
            case "WriteRows":
            case "DeleteRows":
            case "UpdateRows":
                return this.handleRowsEvent(event as DeleteRowsEvent | UpdateRowsEvent | WriteRowsEvent);
            case "Xid":
                this.handleXidEvent(event as XidEvent);
                break;
        }
    }

    private handleQueryEvent(event: QueryEvent): void {
        switch (event.query) {
            case "BEGIN":
                if (this.txInProgress) {
                    log.error("BinlogTransactionBuilder Query BEGIN when sqlTxInProgress is not complete", event, this.txInProgress);
                    this.emitSqlTx();
                }
                this.txInProgress = {
                    binlogName: this.binlogName,
                    nextPosition: event.nextPosition,
                    statements: []
                };
                break;
            case "COMMIT":
                if (!this.txInProgress) {
                    log.error("BinlogTransactionBuilder Query COMMIT when no sqlTxInProgress", event);
                    break;
                }
                this.txInProgress.nextPosition = event.nextPosition;
                this.emitSqlTx();
                break;
            case "ROLLBACK":
                this.txInProgress = null;
                break;
        }
    }

    private handleRotateEvent(event: RotateEvent): void {
        this.binlogName = event.binlogName;
    }

    private handleRowsEvent(event: DeleteRowsEvent | UpdateRowsEvent | WriteRowsEvent): void {
        if (!this.txInProgress) {
            log.error("BinlogTransactionBuilder", event.getTypeName(), "when sqlTxInProgress is null", event, this.txInProgress);
            return;
        }
        this.txInProgress.nextPosition = event.nextPosition;
        this.txInProgress.statements.push(mysqlEventDataNormalizer(event));
    }

    private handleXidEvent(event: XidEvent): void {
        if (!this.txInProgress) {
            log.error("BinlogTransactionBuilder XID when no sqlTxInProgress", event);
            return;
        }
        this.txInProgress.nextPosition = event.nextPosition;
        this.emitSqlTx();
    }

    private emitSqlTx(): void {
        this.emit("transaction", this.txInProgress);
        this.txInProgress = null;
    }
}

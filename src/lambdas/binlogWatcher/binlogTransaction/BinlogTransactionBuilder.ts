import EventEmitter = require("events");
import log = require("loglevel");
import {mysqlEventDataNormalizer} from "./mysqlEventDataNormalizer";
import {BinlogTransaction} from "./BinlogTransaction";
import {
    DeleteRowsEvent,
    QueryEvent,
    UpdateRowsEvent,
    WriteRowsEvent,
    XidEvent,
    ZongJiEvent
} from "../binlogStream/ZongJiEvent";

export class BinlogTransactionBuilder extends EventEmitter {

    private txInProgress: BinlogTransaction = null;

    handleBinlogEvent(binlogName: string, event: ZongJiEvent): void {
        switch (event.getTypeName()) {
            case "Query":
                this.handleQueryEvent(binlogName, event as QueryEvent);
                break;
            case "WriteRows":
            case "DeleteRows":
            case "UpdateRows":
                return this.handleRowsEvent(binlogName, event as DeleteRowsEvent | UpdateRowsEvent | WriteRowsEvent);
            case "Xid":
                this.handleXidEvent(binlogName, event as XidEvent);
                break;
        }
    }

    private handleQueryEvent(binlogName: string, event: QueryEvent): void {
        switch (event.query) {
            case "BEGIN":
                if (this.txInProgress) {
                    log.error("BinlogTransactionBuilder Query BEGIN when txInProgress is not complete", event, this.txInProgress);
                    this.emitTransaction();
                }
                this.txInProgress = {
                    binlogName: binlogName,
                    nextPosition: event.nextPosition,
                    statements: []
                };
                break;
            case "COMMIT":
                this.checkTxContinuation(binlogName, event);
                this.txInProgress.nextPosition = event.nextPosition;
                this.emitTransaction();
                break;
            case "ROLLBACK":
                this.txInProgress = null;
                break;
        }
    }

    private handleRowsEvent(binlogName: string, event: DeleteRowsEvent | UpdateRowsEvent | WriteRowsEvent): void {
        this.checkTxContinuation(binlogName, event);
        this.txInProgress.nextPosition = event.nextPosition;
        this.txInProgress.statements.push(mysqlEventDataNormalizer(event, binlogName));
    }

    private handleXidEvent(binlogName: string, event: XidEvent): void {
        this.checkTxContinuation(binlogName, event);
        this.txInProgress.nextPosition = event.nextPosition;
        this.emitTransaction();
    }

    private checkTxContinuation(binlogName: string, event: ZongJiEvent): void {
        if (!this.txInProgress) {
            log.error("BinlogTransactionBuilder received", event.getTypeName(), "when txInProgress is null. binlogName=", binlogName, "event=", event, "txInProgress=", this.txInProgress);
            throw new Error(`BinlogTransactionBuilder received ${event.getTypeName()} when txInProgress is null.`);
        }
        if (binlogName !== this.txInProgress.binlogName) {
            log.error("BinlogTransactionBuilder received event from binlogName", binlogName, "which does not match transaction in progress. binlogName=", binlogName, "event=", event, "txInProgress=", this.txInProgress);
            throw new Error(`BinlogTransactionBuilder received event from binlogName ${binlogName} which does not match transaction in progress.`);
        }
    }

    private emitTransaction(): void {
        this.emit("transaction", this.txInProgress);
        this.txInProgress = null;
    }
}

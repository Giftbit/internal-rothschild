import log = require("loglevel");
import {mysqlEventDataNormalizer} from "./mysqlEventDataNormalizer";
import {BinlogTransaction} from "./BinlogTransaction";
import {
    DeleteRowsEvent,
    QueryEvent,
    RotateEvent,
    UpdateRowsEvent,
    WriteRowsEvent,
    XidEvent
} from "../binlogStream/ZongJiEvent";
import {BinlogEvent} from "../binlogStream/BinlogEvent";
import {EventEmitter} from "events";

export class BinlogTransactionBuilder extends EventEmitter {

    private txInProgress: BinlogTransaction = null;

    handleBinlogEvent(event: BinlogEvent): void {
        switch (event.binlog.getTypeName()) {
            case "Rotate":
                this.handleRotateEvent(event as BinlogEvent<RotateEvent>);
                break;
            case "Query":
                this.handleQueryEvent(event as BinlogEvent<QueryEvent>);
                break;
            case "WriteRows":
            case "DeleteRows":
            case "UpdateRows":
                return this.handleRowsEvent(event as BinlogEvent<DeleteRowsEvent | UpdateRowsEvent | WriteRowsEvent>);
            case "Xid":
                this.handleXidEvent(event as BinlogEvent<XidEvent>);
                break;
        }
    }

    private handleRotateEvent(event: BinlogEvent<RotateEvent>): void {
        if (this.txInProgress) {
            // Most likely reason is a crash in the middle of a transaction.  The transaction is not committed.
            log.warn("BinlogTransactionBuilder received", event.binlog.getTypeName(), "when txInProgress is *not* null. event=", event, "txInProgress=", this.txInProgress);
            this.cancelTransaction();
        }
    }

    private handleQueryEvent(event: BinlogEvent<QueryEvent>): void {
        switch (event.binlog.query) {
            case "BEGIN":
                if (this.txInProgress) {
                    log.warn("BinlogTransactionBuilder Query BEGIN when txInProgress is not complete.  Possible crash in the middle of previous transaction.", event, this.txInProgress);
                    this.cancelTransaction();
                }
                this.emit("transactionStart");
                this.txInProgress = {
                    binlogName: event.binlogName,
                    nextPosition: event.binlog.nextPosition,
                    statements: []
                };
                break;
            case "COMMIT":
                if (!this.isTxContinuation(event)) {
                    break;
                }
                this.txInProgress.nextPosition = event.binlog.nextPosition;
                this.emitTransaction();
                break;
            case "ROLLBACK":
                this.cancelTransaction();
                break;
        }
    }

    private handleRowsEvent(event: BinlogEvent<DeleteRowsEvent | UpdateRowsEvent | WriteRowsEvent>): void {
        if (!this.isTxContinuation(event)) {
            return;
        }
        this.txInProgress.nextPosition = event.binlog.nextPosition;
        this.txInProgress.statements.push(mysqlEventDataNormalizer(event.binlog));
    }

    private handleXidEvent(event: BinlogEvent<XidEvent>): void {
        if (!this.isTxContinuation(event)) {
            return;
        }
        this.txInProgress.nextPosition = event.binlog.nextPosition;
        this.emitTransaction();
    }

    private isTxContinuation(event: BinlogEvent): boolean {
        if (!this.txInProgress) {
            // Most likely reason is a bad restart in the middle of a transaction.
            log.warn("BinlogTransactionBuilder received", event.binlog.getTypeName(), "when txInProgress is null. event=", event, "txInProgress=", this.txInProgress);
            return false;
        }
        if (event.binlogName !== this.txInProgress.binlogName) {
            // Transactions cannot cross boundaries in binlogs.
            log.error("BinlogTransactionBuilder received event from binlogName", event.binlogName, "which does not match transaction in progress. event=", event, "txInProgress=", this.txInProgress);
            this.txInProgress = null;
            return false;
        }
        return true;
    }

    private cancelTransaction(): void {
        this.txInProgress = null;
    }

    private emitTransaction(): void {
        const tx = this.txInProgress;
        this.txInProgress = null;
        this.emit("transaction", tx);
    }
}

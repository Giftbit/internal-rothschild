import EventEmitter = require("events");
import log = require("loglevel");
import {mysqlEventDataNormalizer} from "./mysqlEventDataNormalizer";
import {BinlogTransaction} from "./BinlogTransaction";
import {DeleteRowsEvent, QueryEvent, UpdateRowsEvent, WriteRowsEvent, XidEvent} from "../binlogStream/ZongJiEvent";
import {BinlogEvent} from "../binlogStream/BinlogEvent";

export class BinlogTransactionBuilder extends EventEmitter {

    private txInProgress: BinlogTransaction = null;

    handleBinlogEvent(event: BinlogEvent): void {
        switch (event.binlog.getTypeName()) {
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

    private handleQueryEvent(event: BinlogEvent<QueryEvent>): void {
        switch (event.binlog.query) {
            case "BEGIN":
                if (this.txInProgress) {
                    log.error("BinlogTransactionBuilder Query BEGIN when txInProgress is not complete", event, this.txInProgress);
                    this.emitTransaction();
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
                this.txInProgress = null;
                this.emit("transactionEnd");
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

    private emitTransaction(): void {
        const tx = this.txInProgress;
        this.txInProgress = null;
        this.emit("transaction", tx);
        this.emit("transactionEnd");
    }
}

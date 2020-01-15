import log = require("loglevel");
import mysql = require("mysql");
import ZongJi = require("zongji");
import ZongJiCommon = require("zongji/lib/common");
import {ZongJiOptions} from "./ZongJiOptions";
import {QueryEvent, RotateEvent, ZongJiEvent} from "./ZongJiEvent";
import {EventEmitter} from "events";

/**
 * Wraps ZongJi to create a stable stream of MySQL binlog events.
 *
 * Inspired by https://github.com/rodrigogs/mysql-events/
 * and https://gist.github.com/numtel/5b37b2a7f47b380c1a099596c6f3db2f
 *
 * Being an EventEmitter this will spew events as fast as it can with no possibility
 * for back pressure.  That's fine as long as the consumer can keep up but if that
 * ever stops being that case we'll have to rewrite this.
 */
export class BinlogStream extends EventEmitter {

    private zongJi: ZongJi = null;
    private connection: mysql.Connection;

    constructor(private connectionOptions: mysql.ConnectionConfig) {
        super();
    }

    async start(zongJiOptions: ZongJiOptions): Promise<void> {
        if (this.zongJi) {
            throw new Error("Already started.");
        }

        log.info("BinlogStream starting");

        let connectionHasErrored = false;
        let binlogName: string | null = zongJiOptions.filename || null;
        let binlogPosition: number | null = null;
        const onError = async () => {
            if (!connectionHasErrored) {
                // Only reconnect on the first error for this connection.
                connectionHasErrored = true;

                log.info("BinlogStream restarting from", binlogName, binlogPosition);
                try {
                    await this.stop();
                    await this.start(binlogPosition === null ? zongJiOptions : {
                        ...zongJiOptions,
                        startAtEnd: false,
                        filename: binlogName,
                        position: binlogPosition
                    });
                } catch (restartError) {
                    log.error("BinlogStream error restarting.  Letting the Lambda die.", restartError);
                }
            }
        };

        this.connection = mysql.createConnection(this.connectionOptions);
        this.connection.on("error", async err => {
            log.error("BinlogStream connection error", err);
            onError();
        });

        this.zongJi = new ZongJi(this.connection);
        this.zongJi.on("error", err => {
            log.error("BinlogStream ZongJi error", err);
            onError();
        });
        this.zongJi.on("ready", () => {
            log.info("BinlogStream ZongJi ready");
        });
        this.zongJi.on("binlog", (event: ZongJiEvent) => {
            // Useful for debugging BinlogStream but commented out normally because it's *really* noisy.
            // log.debug(event.getTypeName(), this.summarizeEventForDebugging(event), binlogName, binlogPosition);
            if (event.getTypeName() === "Rotate") {
                binlogName = (event as RotateEvent).binlogName;
            }
            this.emit("binlog", {
                binlog: event,
                binlogName: binlogName
            });
            binlogPosition = event.nextPosition;
        });
        this.zongJi.start(zongJiOptions);

        this.emit("BinlogStream started");
    }

    async stop(): Promise<void> {
        if (!this.zongJi) {
            return;
        }

        log.info("BinlogStream stopping");

        this.zongJi.stop();
        await new Promise((resolve, reject) => {
            this.connection.end(err => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });

        this.zongJi = null;
        this.connection = null;

        log.info("BinlogStream stopped");
    }

    // noinspection JSUnusedGlobalSymbols This is useful for debugging but too noisy to usually leave on.
    summarizeEventForDebugging(event: ZongJiEvent): string {
        if (event.getTypeName() === "Query") {
            if ((event as QueryEvent).query.length > 16) {
                return (event as QueryEvent).query.substring(0, 16) + "…";
            }
            return (event as QueryEvent).query;
        }
        return "";
    }
}

// Oh God this is just the worst.  So MySQL doesn't have a BOOL type but rather uses
// TINY INT storing 0 or 1.  That is the only way we use TINY INT.  ZongJi parses
// TINY INT as a number (where we want a boolean) and doesn't expose a way to
// configure that.  So we'll do this gross hack and force it.
const unhackedReadMysqlValue = ZongJiCommon.readMysqlValue;
if (!unhackedReadMysqlValue) {
    throw new Error("zongji/lib/common.readMysqlValue() not found.  The hacks are broken.");
}
ZongJiCommon.readMysqlValue = function (parser, column, columnSchema, tableMap, zongji) {
    if (column.type === 1) {
        return !!unhackedReadMysqlValue.apply(this, arguments);
    }
    return unhackedReadMysqlValue.apply(this, arguments);
};

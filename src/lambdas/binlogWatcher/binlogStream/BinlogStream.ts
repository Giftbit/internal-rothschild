import EventEmitter = require("events");
import log = require("loglevel");
import mysql = require("mysql");
import ZongJi = require("zongji");
import {ZongJiOptions} from "./ZongJiOptions";
import {BinlogTransactionBuilder} from "./BinlogTransactionBuilder";
import {ZongJiEvent} from "./ZongJiEvent";

/**
 * Inspired by https://github.com/rodrigogs/mysql-events/
 */
export class BinlogStream extends EventEmitter {

    private txBuilder = new BinlogTransactionBuilder();
    private zongJi: ZongJi = null;
    private connection: mysql.Connection;

    constructor(private connectionOptions: mysql.ConnectionConfig) {
        super();
        this.txBuilder.on("transaction", tx => {
            this.emit("transaction", tx);
        });
    }

    async start(zongJiOptions: ZongJiOptions): Promise<void> {
        if (this.zongJi) {
            throw new Error("Already started.");
        }

        log.info("BinlogStream starting");

        let connectionHasErrored = false;
        const onError = async () => {
            if (!connectionHasErrored) {
                // Only reconnect on the first error for this connection.
                connectionHasErrored = true;

                const binlogName = this.zongJi.binlogName;
                const binlogNextPos = this.zongJi.binlogNextPos;
                log.info("BinlogStream restarting from", binlogName, binlogNextPos);

                try {
                    await this.stop();
                    await this.start({
                        ...zongJiOptions,
                        startAtEnd: false,
                        filename: binlogName,
                        position: binlogNextPos
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
            // console.log(event);
            if (event.getTypeName() === "Rotate") {
                // handle file change
            }
            this.txBuilder.handleBinlogEvent(event);
            // handle position change
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
}

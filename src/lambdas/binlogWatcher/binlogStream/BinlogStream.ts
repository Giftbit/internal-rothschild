import EventEmitter = require("events");
import log = require("loglevel");
import mysql = require("mysql");
import ZongJi = require("zongji");
import {ZongJiOptions} from "./ZongJiOptions";
import {RotateEvent, ZongJiEvent} from "./ZongJiEvent";
import {TypedEventEmitter} from "../TypedEventEmitter";

/**
 * Inspired by https://github.com/rodrigogs/mysql-events/
 * and https://gist.github.com/numtel/5b37b2a7f47b380c1a099596c6f3db2f
 */
export class BinlogStream extends EventEmitter implements TypedEventEmitter<{ binlog: ZongJiEvent }> {

    private zongJi: ZongJi = null;
    private connection: mysql.Connection;
    binlogName: string | null = null;
    binlogPosition: number | null = null;

    constructor(private connectionOptions: mysql.ConnectionConfig) {
        super();
    }

    async start(zongJiOptions: ZongJiOptions): Promise<void> {
        if (this.zongJi) {
            throw new Error("Already started.");
        }

        log.info("BinlogStream starting");

        if (zongJiOptions.filename && zongJiOptions.position != null) {
            this.binlogName = zongJiOptions.filename;
            this.binlogPosition = zongJiOptions.position;
        } else {
            this.binlogName = null;
            this.binlogPosition = null;
        }

        let connectionHasErrored = false;
        const onError = async () => {
            if (!connectionHasErrored) {
                // Only reconnect on the first error for this connection.
                connectionHasErrored = true;

                log.info("BinlogStream restarting from", this.binlogName, this.binlogPosition);
                try {
                    await this.stop();
                    await this.start({
                        ...zongJiOptions,
                        startAtEnd: false,
                        filename: this.binlogName,
                        position: this.binlogPosition
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
                this.binlogName = (event as RotateEvent).binlogName;
            }
            this.emit("binlog", event);
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

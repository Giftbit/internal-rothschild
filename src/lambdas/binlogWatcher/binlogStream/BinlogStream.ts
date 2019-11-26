import EventEmitter = require("events");
import log = require("loglevel");
import mysql = require("mysql");
import ZongJi = require("zongji");
import {ZongJiOptions} from "./ZongJiOptions";
import {BinlogTransactionBuilder} from "./BinlogTransactionBuilder";

/**
 * Inspired by https://github.com/rodrigogs/mysql-events/
 */
export class BinlogStream extends EventEmitter {

    private txBuilder = new BinlogTransactionBuilder();
    private zongJi: ZongJi = null;
    private connection: mysql.Connection;

    constructor(private connectionOptions: mysql.ConnectionConfig, private zongJiOptions: ZongJiOptions) {
        super();
        this.txBuilder.on("transaction", tx => {
            this.emit("transaction", tx);
            // TODO use last tx to keep track of where to reconnect to
        });
    }

    async start(): Promise<void> {
        if (this.zongJi) {
            return;
        }

        this.connection = mysql.createConnection(this.connectionOptions);
        this.connection.on("error", async err => {
            log.error("BinlogStream connection error", err);
            // TODO reconnect?  https://gist.github.com/numtel/5b37b2a7f47b380c1a099596c6f3db2f
        });

        this.zongJi = new ZongJi(this.connection);
        this.zongJi.on("error", err => {
            log.error("BinlogStream ZongJi error", err);
        });
        this.zongJi.on("ready", () => {
            this.txBuilder.reset(this.zongJi.binlogName);
        });
        this.zongJi.on("binlog", (event) => {
            // console.log(event);
            this.txBuilder.handleBinlogEvent(event);
        });
        this.zongJi.start(this.zongJiOptions);

        this.emit("started");
    }

    async stop(): Promise<void> {
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
    }
}

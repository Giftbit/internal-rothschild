import * as awslambda from "aws-lambda";
import * as logPrefix from "loglevel-plugin-prefix";
import {getDbCredentials} from "../../utils/dbUtils/connection";
import {BinlogStream} from "./binlogStream/BinlogStream";
import {BinlogTransactionBuilder} from "./binlogTransaction/BinlogTransactionBuilder";
import {getLightrailEvents} from "./getLightrailMessages/getLightrailEvents";
import {BinlogWatcherStateManager} from "./BinlogWatcherStateManager";
import {LightrailEventPublisher} from "../LightrailEventPublisher";
import {BinlogTransaction} from "./binlogTransaction/BinlogTransaction";
import log = require("loglevel");

// Wrapping console.log instead of binding (default behaviour for loglevel)
// Otherwise all log calls are prefixed with the requestId from the first
// request the lambda received (AWS modifies log calls, loglevel binds to the
// version of console.log that exists when it is initialized).
// See https://github.com/pimterry/loglevel/blob/master/lib/loglevel.js
// tslint:disable-next-line:no-console
log.methodFactory = () => (...args) => console.log(...args);

// Prefix log messages with the level.
logPrefix.reg(log);
logPrefix.apply(log, {
    format: (level, name, timestamp) => {
        return `[${level}]`;
    }
});

log.setLevel(process.env.LOG_LEVEL as any || log.levels.INFO);

export async function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<any> {

}

export async function createMySqlEventsInstance(): Promise<BinlogStream> {
    // TODO Don't use master credentials.  Create a readrep user and use those credentials.
    // They can be passed in using the usual env vars though so this code is fine.
    const dbCredentials = await getDbCredentials();

    const binlogStream = new BinlogStream({
        host: process.env["DB_ENDPOINT"],
        user: dbCredentials.username,
        password: dbCredentials.password,
        port: +process.env["DB_PORT"],
        timezone: "Z"
    });


    const txBuilder = new BinlogTransactionBuilder();
    binlogStream.on("binlog", event => txBuilder.handleBinlogEvent(event));

    const binlogWatcherStateManager = new BinlogWatcherStateManager();
    // await binlogWatcherStateManager.load();  // TODO

    const publisher = new LightrailEventPublisher();
    txBuilder.on("transaction", async (tx: BinlogTransaction) => {
        try {
            binlogWatcherStateManager.openCheckpoint(tx.binlogName, tx.nextPosition);
            const events = await getLightrailEvents(tx);
            await publisher.publishAllAtOnce(events);
            binlogWatcherStateManager.closeCheckpoint(tx.binlogName, tx.nextPosition);
        } catch (err) {
            log.error("Error getting LightrailEvents", err);
        }
    });

    await binlogStream.start({
        serverId: 1234,
        filename: binlogWatcherStateManager.state?.checkpoint?.binlogName,      // bin.000025
        position: binlogWatcherStateManager.state?.checkpoint?.binlogPosition,  // 0
        excludeSchema: {
            mysql: true,
        }
    });

    return binlogStream;
}

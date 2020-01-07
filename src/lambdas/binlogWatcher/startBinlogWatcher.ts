import {LightrailEventPublisher} from "./lightrailEventPublisher/LightrailEventPublisher";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {BinlogStream} from "./binlogStream/BinlogStream";
import {BinlogTransactionBuilder} from "./binlogTransaction/BinlogTransactionBuilder";
import {BinlogEvent} from "./binlogStream/BinlogEvent";
import {BinlogTransaction} from "./binlogTransaction/BinlogTransaction";
import {getLightrailEvents} from "./lightrailEvents/getLightrailEvents";
import {getDbCredentials} from "../../utils/dbUtils/connection";
import log = require("loglevel");

export async function startBinlogWatcher(stateManager: BinlogWatcherStateManager,
                                         publisher: LightrailEventPublisher): Promise<BinlogStream> {
    const dbCredentials = await getDbCredentials(); // TODO set up read rep user and put credentials in env
    const binlogStream = new BinlogStream({
        host: process.env["DB_ENDPOINT"],
        user: dbCredentials.username,
        password: dbCredentials.password,
        port: +process.env["DB_PORT"],
        timezone: "Z"
    });

    const txBuilder = new BinlogTransactionBuilder();
    binlogStream.on("binlog", (event: BinlogEvent) => {
        txBuilder.handleBinlogEvent(event);
        if (event.binlog.getTypeName() === "Rotate") {
            // Checkpointing is safe here because transactions cannot span binlog files.
            // Doing so prevents us from losing track of progress in the face of an epic
            // string of binlog events without a transaction.
            stateManager.openCheckpoint(event.binlogName, event.binlog.nextPosition);
            stateManager.closeCheckpoint(event.binlogName, event.binlog.nextPosition);
        }
    });

    txBuilder.on("transaction", async (tx: BinlogTransaction) => {
        try {
            stateManager.openCheckpoint(tx.binlogName, tx.nextPosition);
            const events = await getLightrailEvents(tx);
            await publisher.publishAllAtOnce(events);
            stateManager.closeCheckpoint(tx.binlogName, tx.nextPosition);
        } catch (err) {
            log.error("Error getting LightrailEvents", err);
        }
    });

    await binlogStream.start({
        serverId: 1234,
        filename: stateManager.state?.checkpoint?.binlogName,      // bin.000025
        position: stateManager.state?.checkpoint?.binlogPosition,  // 0
        excludeSchema: {
            mysql: true,
        }
    });

    return binlogStream;
}

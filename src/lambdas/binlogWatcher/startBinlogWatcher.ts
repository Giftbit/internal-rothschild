import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailEventPublisher} from "./lightrailEventPublisher/LightrailEventPublisher";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {BinlogStream} from "./binlogStream/BinlogStream";
import {BinlogTransactionBuilder} from "./binlogTransaction/BinlogTransactionBuilder";
import {BinlogEvent} from "./binlogStream/BinlogEvent";
import {BinlogTransaction} from "./binlogTransaction/BinlogTransaction";
import {getLightrailEvents} from "./lightrailEvents/getLightrailEvents";
import {getDbCredentials, getKnexWrite} from "../../utils/dbUtils/connection";
import {LightrailEvent} from "./lightrailEvents/LightrailEvent";
import {QueryEvent} from "./binlogStream/ZongJiEvent";
import log = require("loglevel");

/**
 * Starts BinlogWatcher by opening a BinlogStream and wiring it up to the given
 * BinlogWatcherStateManager and LightrailEventPublisher.
 * @param stateManager
 * @param publisher
 */
export async function startBinlogWatcher(stateManager: BinlogWatcherStateManager,
                                         publisher: LightrailEventPublisher): Promise<BinlogStream> {
    const dbCredentials = await getDbCredentials();
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
        if (event.binlog.getTypeName() !== "Rotate" || event.binlog.getTypeName() === "Query") {
            // Checkpointing here prevents us from losing our place in the face of a drought of SQL transactions.
            // If we're in the middle of events about a SQL Transaction open checkpoints will prevent us from
            // moving forward, but there's no point doing this work for events that are definitely about that.
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
            giftbitRoutes.sentry.sendErrorNotification(err);
        }
    });

    await binlogStream.start({
        serverId: +(process.env["READ_REPLICA_SERVER_ID"] ?? 1234),
        filename: stateManager.state?.checkpoint?.binlogName,
        position: stateManager.state?.checkpoint?.binlogPosition,
        includeSchema: {
            rothschild: true,
        }
    });

    return binlogStream;
}

/**
 * Collect LightrailEvents created during the execution of the given `eventGenerator`
 * function for testing.  This is similar to the startBinlogWatcher() above but
 * it's easier to set up and the LightrailEvents produced are guaranteed to be only
 * from the eventGenerator.
 */
export async function testLightrailEvents(eventGenerator: () => Promise<void>): Promise<LightrailEvent[]> {
    const sentinelUser = "binlogtest-" + Math.random().toString(36).substr(0, 5);
    let hasSeenOpeningSentinel = false;
    let hasSeenClosingSentinel = false;
    let lightrailEvents: LightrailEvent[] = [];

    const dbCredentials = await getDbCredentials();
    const binlogStream = new BinlogStream({
        host: process.env["DB_ENDPOINT"],
        user: dbCredentials.username,
        password: dbCredentials.password,
        port: +process.env["DB_PORT"],
        timezone: "Z"
    });

    const txBuilder = new BinlogTransactionBuilder();
    binlogStream.on("binlog", (event: BinlogEvent) => {
        if (!hasSeenOpeningSentinel) {
            // Look for a specific binlog event that marks the beginning of the events we care about.
            if (event.binlog.getTypeName() === "Query" && (event as BinlogEvent<QueryEvent>).binlog.query.startsWith(`CREATE USER '${sentinelUser}'@'localhost'`)) {
                hasSeenOpeningSentinel = true;
            }
        } else if (!hasSeenClosingSentinel) {
            txBuilder.handleBinlogEvent(event);
        }
    });

    txBuilder.on("transaction", async (tx: BinlogTransaction) => {
        try {
            const events = await getLightrailEvents(tx);
            lightrailEvents = [...lightrailEvents, ...JSON.parse(JSON.stringify(events))];
        } catch (err) {
            log.error("Error getting LightrailEvents", err);
        }
    });

    await binlogStream.start({
        serverId: 1234,
        includeSchema: {
            rothschild: true,
        }
    });

    // Block on all previous SQL transactions completing and then trigger
    // a binlog event we will look for to mark the start of events we care about.
    const knex = await getKnexWrite();
    await knex.raw("FLUSH TABLE WITH READ LOCK");
    await knex.raw("UNLOCK TABLES");
    await knex.raw(`CREATE USER '${sentinelUser}'@'localhost' IDENTIFIED BY 'password'`);

    await eventGenerator();

    await new Promise(async resolve => {
        binlogStream.on("binlog", (event: BinlogEvent) => {
            // Look for a specific binlog event that marks the end of the events we care about.
            if (event.binlog.getTypeName() === "Query" && (event as BinlogEvent<QueryEvent>).binlog.query.startsWith(`DROP USER '${sentinelUser}'@'localhost'`)) {
                hasSeenClosingSentinel = true;
                resolve();
            }
        });

        // Block on all previous SQL transactions completing and then trigger
        // a binlog event we will look for to mark the end of events we care about.
        await knex.raw("FLUSH TABLE WITH READ LOCK");
        await knex.raw("UNLOCK TABLES");
        await knex.raw(`DROP USER '${sentinelUser}'@'localhost'`);
    });

    await binlogStream.stop();

    return lightrailEvents;
}

import * as awslambda from "aws-lambda";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as logPrefix from "loglevel-plugin-prefix";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {startBinlogWatcher} from "./startBinlogWatcher";
import {LightrailEventSnsPublisher} from "./lightrailEventPublisher/LightrailEventSnsPublisher";
import {BinlogEvent} from "./binlogStream/BinlogEvent";
import {MetricsLogger} from "../../utils/metricsLogger";
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

async function handleScheduleEvent(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<any> {
    const stateManager = new BinlogWatcherStateManager();
    await stateManager.load();
    const publisher = new LightrailEventSnsPublisher();
    const binlogStream = await startBinlogWatcher(stateManager, publisher);

    // Spin until there are 15 seconds left in execution time or there have been no events for `maxIdleMillis`.
    const maxIdleMillis = 45000;
    let binlogEventCount = 0;
    let lastBinlogEventReceivedMillis = Date.now();
    let lastBinlogEventLatency = 0;
    binlogStream.on("binlog", (event: BinlogEvent) => {
        binlogEventCount++;
        lastBinlogEventReceivedMillis = Date.now();
        lastBinlogEventLatency = lastBinlogEventReceivedMillis - event.binlog.timestamp;
    });
    while (Date.now() - lastBinlogEventReceivedMillis < maxIdleMillis && ctx.getRemainingTimeInMillis() > 15001) {
        await new Promise(resolve => setTimeout(resolve, Math.min(maxIdleMillis, ctx.getRemainingTimeInMillis() - 15000)));
        MetricsLogger.binlogWatcherLatency(lastBinlogEventLatency);
        lastBinlogEventLatency = 0;
    }

    log.info("Stopping with", ctx.getRemainingTimeInMillis(), "millis remaining,", binlogEventCount, "binlog events processed.");
    MetricsLogger.binlogWatcherEvents(binlogEventCount);

    try {
        await Promise.race([
            binlogStream.stop(),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error("timed out")), 5000))
        ]);
    } catch (err) {
        log.error("Error stopping BinlogWatcher", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        await Promise.race([
            stateManager.save(),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error("timed out")), 5000))
        ]);
    } catch (err) {
        log.error("Error saving BinlogWatcherState", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
    }
}

// Export the lambda handler with Sentry error logging supported.
export const handler = giftbitRoutes.sentry.wrapLambdaHandler({
    handler: handleScheduleEvent,
    logger: log.error,
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
});

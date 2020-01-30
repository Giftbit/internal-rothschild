import * as awslambda from "aws-lambda";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as logPrefix from "loglevel-plugin-prefix";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {startBinlogWatcher} from "./startBinlogWatcher";
import {LightrailEventSnsPublisher} from "./lightrailEventPublisher/LightrailEventSnsPublisher";
import {BinlogEvent} from "./binlogStream/BinlogEvent";
import {MetricsLogger} from "../../utils/metricsLogger";
import {CodeCryptographySecrets, initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils";
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

// We never show the code but generic codes get decrypted automatically
// when we fetch the Value.
initializeCodeCryptographySecrets(
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<CodeCryptographySecrets>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_CODE_CRYTPOGRAPHY")
);

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
        if (event.binlog.getTypeName() !== "Rotate" && event.binlog.getTypeName() !== "Format") {
            // When resuming a binlog event stream mid-way through the first Rotate and Format events in the log are sent.
            binlogEventCount++;
            lastBinlogEventReceivedMillis = Date.now();
            
            // Rotate doesn't have a timestamp anyways and the Format timestamp is misleading as to our latency.
            lastBinlogEventLatency = lastBinlogEventReceivedMillis - event.binlog.timestamp;
        }
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
            new Promise((resolve, reject) => setTimeout(() => reject(new Error("timed out stopping binlog stream")), 5000))
        ]);
    } catch (err) {
        log.error("Error stopping BinlogWatcher", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
    }

    // Wait a little in case any events are processing/sending after we close the stream.
    // It's not the end of the world if they don't finish.  We'll process them next time.
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        await Promise.race([
            stateManager.save(),
            new Promise((resolve, reject) => setTimeout(() => reject(new Error("timed out saving state")), 5000))
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

import * as awslambda from "aws-lambda";
import * as logPrefix from "loglevel-plugin-prefix";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {startBinlogWatcher} from "./startBinlogWatcher";
import {LightrailEventSnsPublisher} from "./lightrailEventPublisher/LightrailEventSnsPublisher";
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
    const stateManager = new BinlogWatcherStateManager();
    await stateManager.load();
    const publisher = new LightrailEventSnsPublisher();
    const binlogStream = await startBinlogWatcher(stateManager, publisher);

    // TODO if there's no activity for a minute also resolve this
    await new Promise(resolve => setTimeout(resolve, ctx.getRemainingTimeInMillis() - 15000));

    try {
        await Promise.race([
            binlogStream.stop(),
            new Promise((resolve, reject) => {
                setTimeout(() => reject(new Error("timed out")), 5000);
            })
        ]);
    } catch (err) {
        log.error("Error stopping BinlogWatcher", err);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        await Promise.race([
            stateManager.save(),
            new Promise((resolve, reject) => {
                setTimeout(() => reject(new Error("timed out")), 5000);
            })
        ]);
    } catch (err) {
        log.error("Error saving BinlogWatcherState", err);
    }
}

import * as awslambda from "aws-lambda";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as logPrefix from "loglevel-plugin-prefix";
import {voidExpiredPending} from "./voidExpiredPending";
import {CodeCryptographySecrets, initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils";
import log = require("loglevel");

// Wrapping console.log instead of binding (default behaviour for loglevel)
// Otherwise all log calls are prefixed with the requestId from the first
// request the lambda received (AWS modifies log calls, loglevel binds to the
// version of console.log that exists when it is initialized).
// See https://github.com/pimterry/loglevel/blob/master/lib/loglevel.js
log.methodFactory = function () {
    return function () {
        console.log(...arguments);
    };
};

// Prefix log messages with the level.
logPrefix.reg(log);
logPrefix.apply(log, {
    format: (level, name, timestamp) => {
        return `[${level}]`;
    },
});

// Set the log level when running in Lambda.
log.setLevel(log.levels.INFO);

// We never show the code but generic codes get decrypted automatically
// when we fetch the Value.
initializeCodeCryptographySecrets(
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<CodeCryptographySecrets>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_CODE_CRYTPOGRAPHY")
);

async function handleScheduleEvent(evt: awslambda.ScheduledEvent, ctx: awslambda.Context): Promise<any> {
    return voidExpiredPending(ctx);
}

// Export the lambda handler with Sentry error logging supported.
export const handler = giftbitRoutes.sentry.wrapLambdaHandler({
    handler: handleScheduleEvent,
    logger: log.error,
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
});

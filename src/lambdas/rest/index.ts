import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as logPrefix from "loglevel-plugin-prefix";
import {installRestRoutes} from "./installRestRoutes";
import {CodeCryptographySecrets, initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils"; // Prefix log messages with the level.
import {initializeIntercomSecrets, IntercomSecrets} from "../../utils/intercomUtils";
import log = require("loglevel");

// Prefix log messages with the level.
logPrefix.reg(log);
logPrefix.apply(log, {
    format: (level, name, timestamp) => {
        return `[${level}]`;
    },
});

// Set the log level when running in Lambda.
log.setLevel(log.levels.INFO);

const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute({
    logFunction: log.info
}));

router.route(new giftbitRoutes.HealthCheckRoute("/v2/healthCheck"));

router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute({
    authConfigPromise: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT"),
    rolesConfigPromise: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS"),
    merchantKeyUri: `https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/jwtSecret`,
    assumeGetSharedSecretToken: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_STORAGE_SCOPE_TOKEN"),
    infoLogFunction: log.info,
    errorLogFunction: log.error
}));

initializeCodeCryptographySecrets(
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<CodeCryptographySecrets>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_CODE_CRYTPOGRAPHY")
);

initializeIntercomSecrets(
    giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<IntercomSecrets>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_INTERCOM_SECRET")
);

installRestRoutes(router);

// Export the lambda handler with Sentry error logging supported.
export const handler = giftbitRoutes.sentry.wrapLambdaHandler({
    router,
    logger: log.error,
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
});

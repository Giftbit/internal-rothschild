import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as log from "loglevel";
import * as logPrefix from "loglevel-plugin-prefix";
import {installRestRoutes} from "./installRestRoutes";
import {CodeCryptographySecrets, initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils";

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

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
const codeCryptographySecretsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<CodeCryptographySecrets>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_CODE_CRYTPOGRAPHY");
initializeCodeCryptographySecrets(codeCryptographySecretsPromise);

router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

installRestRoutes(router);

// Export the lambda handler with Sentry error logging supported.
export const handler = giftbitRoutes.sentry.wrapLambdaHandler({
    router,
    logger: log.error,
    secureConfig: giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_SENTRY")
});

import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as log from "loglevel";
import * as logPrefix from "loglevel-plugin-prefix";
import {installRestRoutes} from "./installRestRoutes";

// Prefix log messages with the level.
logPrefix.reg(log);
logPrefix.apply(log, {
    format: (level, name, timestamp) => {
        return `[${level}]`;
    },
});

// Set the production log level.
log.setLevel(log.levels.DEBUG);

const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute({
    logFunction: log.info
}));

const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));

installRestRoutes(router);

export const handler = router.getLambdaHandler();

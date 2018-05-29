import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {installContactsRest} from "./contacts";
import {installTransactionsRest} from "./transactions/transactions";
import {installValueStoresRest} from "./values";
import {installValueStoreTemplatesRest} from "./valueStoreTemplates";
import {installCurrenciesRest} from "./currencies";

const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

// const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
// const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
// router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));

/**
 * Install all the rest api routes.  This is exported for easy testing.
 */
export function installRest(router: cassava.Router): void {
    installCurrenciesRest(router);
    installContactsRest(router);
    installValueStoresRest(router);
    installTransactionsRest(router);
    installValueStoreTemplatesRest(router);
}

installRest(router);

export const handler = router.getLambdaHandler();

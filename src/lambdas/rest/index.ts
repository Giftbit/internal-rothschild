import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {installCustomersRest} from "./customers";
import {installTransactionsRest} from "./transactions/transactions";
import {installValueStoresRest} from "./valueStores";
import {installValueStoreTemplatesRest} from "./valueStoreTemplate";

const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

// const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
// const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
// router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));

installCustomersRest(router);
installValueStoresRest(router);
installTransactionsRest(router);
installValueStoreTemplatesRest(router);

export const handler = router.getLambdaHandler();

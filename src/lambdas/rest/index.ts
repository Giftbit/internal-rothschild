import "babel-polyfill";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as contactsRest from "./contactsRest";

const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

// const authConfigPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_JWT");
// const roleDefinitionsPromise = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<any>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ROLE_DEFINITIONS");
// router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(authConfigPromise, roleDefinitionsPromise));
router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));

router.route("/v2/contacts")
    .method("GET")
    .handler(contactsRest.getContacts);

router.route("/v2/contacts")
    .method("POST")
    .handler(contactsRest.createContact);

router.route("/v2/contacts/{contactId}")
    .method("GET")
    .handler(contactsRest.getContact);

router.route("/v2/contacts/{contactId}")
    .method("PUT")
    .handler(contactsRest.updateContact);

router.route("/v2/contacts/{contactId}")
    .method("DELETE")
    .handler(contactsRest.deleteContact);

export const handler = router.getLambdaHandler();

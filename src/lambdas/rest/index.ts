import "babel-polyfill";
import * as cassava from "cassava";
import * as contactsRest from "./contactsRest";

const router = new cassava.Router();

router.route(new cassava.routes.LoggingRoute());

router.route("/v2/contacts")
    .method("GET")
    .handler(contactsRest.getContacts);

router.route("/v2/contacts/{contactId}")
    .method("GET")
    .handler(contactsRest.getContact);

router.route("/v2/contacts/{contactId}")
    .method("PUT")
    .handler(contactsRest.putContact);

export const handler = router.getLambdaHandler();

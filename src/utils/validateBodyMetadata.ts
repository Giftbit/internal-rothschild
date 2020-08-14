import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";

// The size of TEXT field in MySQL: 2^16−1
const maxMetadataSize = 65535;

export function validateBodyMetadata(evt: cassava.RouterEvent): void {
    if (!evt.body?.metadata || typeof evt.body.metadata !== "object") {
        return;
    }

    if (JSON.stringify(evt.body.metadata).length > maxMetadataSize) {
        // There is no rule on JSON size in jsonschema but this error message is formatted
        // to be consistent with those error message.
        throw new giftbitRoutes.GiftbitRestError(422, `The ${evt.httpMethod} body has 1 validation error(s): requestBody.metadata must have a maximum number of ${maxMetadataSize} characters.`);
    }
}

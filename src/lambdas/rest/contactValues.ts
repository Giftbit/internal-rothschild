import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getValue, getValueByCode, getValues} from "./values";
import {csvSerializer} from "../../serializers";
import {Pagination} from "../../model/Pagination";
import {Value} from "../../model/Value";
import {getContact} from "./contacts";
import {getKnexWrite} from "../../utils/dbUtils/connection";

export function installContactValuesRest(router: cassava.Router): void {
    router.route("/v2/contacts/{id}/values")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const res = await getValues(auth, {...evt.queryStringParameters, contactId: evt.pathParameters.id}, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.values
            };
        });

    router.route("/v2/contacts/{id}/values/add")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            evt.validateBody({
                type: "object",
                oneOf: [
                    {
                        properties: {
                            valueId: {
                                type: "string"
                            }
                        },
                        required: ["valueId"]
                    },
                    {
                        properties: {
                            code: {
                                type: "string"
                            }
                        },
                        required: ["code"]
                    }
                ]
            });

            return {
                body: await claimValue(auth, evt.pathParameters.id, evt.body)
            };
        });
}

export async function claimValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, valueIdentifier: {valueId?: string, code?: string}): Promise<Value> {
    // This will throw a 404 if either aren't found.  Is that a good idea?
    const contact = await getContact(auth, contactId);
    const value = await getValueByIdentifier(auth, valueIdentifier);

    const knex = await getKnexWrite();
    const res: number = await knex("Values")
        .where({
            userId: auth.giftbitUserId,
            id: value.id
        })
        .update({
            contactId: contact.id
        });
    if (res === 0) {
        throw new cassava.RestError(404);
    }
    if (res > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
    }
    return {
        ...value,
        contactId: contact.id
    };
}

function getValueByIdentifier(auth: giftbitRoutes.jwtauth.AuthorizationBadge, identifier: {valueId?: string, code?: string}): Promise<Value> {
    if (identifier.valueId) {
        return getValue(auth, identifier.valueId);
    } else if (identifier.code) {
        return getValueByCode(auth, identifier.code);
    }
    throw new Error("Neither valueId nor code specified");
}

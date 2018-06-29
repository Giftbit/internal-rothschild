import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getValue, getValues} from "./values";
import {csvSerializer} from "../../serializers";
import {Pagination} from "../../model/Pagination";
import {Value} from "../../model/Value";
import {getContact} from "./contacts";
import {getKnexWrite} from "../../dbUtils/connection";

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

            if (evt.body.valueId) {
                return {
                    body: await claimValueByValueId(auth, evt.pathParameters.id, evt.body.valueId)
                };
            } else if (evt.body.code) {
                return {
                    body: await claimValueByCode(auth, evt.pathParameters.id, evt.body.code)
                };
            }
            throw new Error("body without valueId or code, shouldn't be reachable");
        });
}

export async function claimValueByValueId(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, valueId: string): Promise<Value> {
    // This will throw a 404 if either aren't found.  Is that a good idea?
    const contact = await getContact(auth, contactId);
    const value = await getValue(auth, valueId);

    // TODO handle generic code

    const knex = await getKnexWrite();
    const res: number = await knex("Values")
        .where({
            userId: auth.giftbitUserId,
            id: valueId
        })
        .update({
            contactId
        });
    if (res === 0) {
        throw new cassava.RestError(404);
    }
    if (res > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
    }
    return {
        ...value,
        contactId
    };
}

export async function claimValueByCode(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, code: string): Promise<Value> {
    throw new Error("TODO");
}

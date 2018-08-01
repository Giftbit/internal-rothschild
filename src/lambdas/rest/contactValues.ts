import * as cassava from "cassava";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as log from "loglevel";
import {getValue, getValueByCode, getValues} from "./values";
import {csvSerializer} from "../../serializers";
import {Pagination} from "../../model/Pagination";
import {Value} from "../../model/Value";
import {getContact} from "./contacts";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {getSqlErrorConstraintName} from "../../utils/dbUtils";

export function installContactValuesRest(router: cassava.Router): void {
    router.route("/v2/contacts/{id}/values")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:values:list:self") && auth.contactId === evt.pathParameters.id) {
                // Badge is signed specifically to list values for this contact.
            } else {
                auth.requireScopes("lightrailV2:values:list");
            }

            const showCode: boolean = (evt.queryStringParameters.showCode === "true");
            const res = await getValues(auth, {...evt.queryStringParameters, contactId: evt.pathParameters.id}, Pagination.getPaginationParams(evt), showCode);
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.values
            };
        });

    router.route("/v2/contacts/{id}/values/attach")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            let allowOverwrite = true;
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:values:attach:self") && auth.contactId === evt.pathParameters.id && evt.body.code && !evt.body.valueId) {
                // Badge is signed specifically to attach a value by code for this contact.
                allowOverwrite = false;
            } else {
                auth.requireScopes("lightrailV2:values:attach");
            }

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
                body: await attachValue(auth, evt.pathParameters.id, evt.body, allowOverwrite)
            };
        });
}

export async function attachValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, valueIdentifier: {valueId?: string, code?: string}, allowOverwrite: boolean): Promise<Value> {
    const contact = await getContact(auth, contactId);
    const value = await getValueByIdentifier(auth, valueIdentifier);

    if (value.isGenericCode) {
        return attachGenericValue(auth, contact.id, value);
    } else {
        return attachUniqueValue(auth, contact.id, value, allowOverwrite);
    }
}

async function attachGenericValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, originalValue: Value): Promise<Value> {
    if (originalValue.uses === 0) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value with id '${originalValue.id}' cannot be attached because it has a generic code and has 0 uses remaining.`, "InsufficientUses");
    }

    const claimedValue: Value = {
        ...originalValue,
        id: crypto.createHash("sha1").update(originalValue.id + "/" + contactId).digest("base64"),
        code: null,
        isGenericCode: null,
        contactId: contactId,
        uses: 1
    };

    const knex = await getKnexWrite();
    await knex.transaction(async trx => {
        if (originalValue.uses != null) {
            const usesDecrementRes: number = await trx("Values")
                .where({
                    userId: auth.userId,
                    id: originalValue.id
                })
                .where("uses", ">", 0)
                .increment("uses", -1);
            if (usesDecrementRes === 0) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value with id '${originalValue.id}' cannot be claimed because it has 0 uses remaining.`, "InsufficientUses");
            }
            if (usesDecrementRes > 1) {
                throw new Error(`Illegal UPDATE query.  Updated ${usesDecrementRes} values.`);
            }
        }

        try {
            await trx("Values")
                .insert(Value.toDbValue(auth, claimedValue));
        } catch (err) {
            log.debug(err);
            const constraint = getSqlErrorConstraintName(err);
            if (constraint === "PRIMARY") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value with id '${originalValue.id}' has already been claimed by the Contact with id '${contactId}'.`, "ValueAlreadyClaimed");
            }
            if (constraint === "fk_Values_Contacts") {
                throw new giftbitRoutes.GiftbitRestError(404, `Contact with id '${contactId}' not found.`, "ContactNotFound");
            }
            throw err;
        }
    });

    return claimedValue;
}

async function attachUniqueValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, value: Value, allowOverwrite: boolean): Promise<Value> {
    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Values")
            .where({
                userId: auth.userId,
                id: value.id
            })
            .andWhere(query => {
                if (!allowOverwrite) {
                    return query.whereNull("contactId");
                }
                return query;
            })
            .update({
                contactId: contactId
            });
        if (res === 0) {
            throw new giftbitRoutes.GiftbitRestError(409, `Value not found.`, "ValueNotFound");
        }
        if (res > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
        }
        return {
            ...value,
            contactId: contactId
        };
    } catch (err) {
        log.debug(err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "fk_Values_Contacts") {
            throw new giftbitRoutes.GiftbitRestError(404, `Contact with id '${contactId}' not found.`, "ContactNotFound");
        }
        throw err;
    }
}

function getValueByIdentifier(auth: giftbitRoutes.jwtauth.AuthorizationBadge, identifier: {valueId?: string, code?: string}): Promise<Value> {
    try {
        if (identifier.valueId) {
            return getValue(auth, identifier.valueId);
        } else if (identifier.code) {
            return getValueByCode(auth, identifier.code);
        }
    } catch (err) {
        if ((err as giftbitRoutes.GiftbitRestError).isRestError && (err as giftbitRoutes.GiftbitRestError).statusCode === 404) {
            throw new giftbitRoutes.GiftbitRestError(409, (err as giftbitRoutes.GiftbitRestError).message, "ValueNotFound");
        }
    }
    throw new Error("Neither valueId nor code specified");
}

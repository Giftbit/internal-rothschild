import * as cassava from "cassava";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {getValue, getValueByCode, getValues, injectValueStats, updateValue, valueExists} from "./values/values";
import {csvSerializer} from "../../utils/serializers";
import {Pagination} from "../../model/Pagination";
import {Value} from "../../model/Value";
import {getContact, getContacts} from "./contacts";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {getSqlErrorConstraintName, nowInDbPrecision} from "../../utils/dbUtils";
import {AttachValueParameters} from "../../model/internal/AttachValueParameters";
import {ValueIdentifier} from "../../model/internal/ValueIdentifier";
import {MetricsLogger, ValueAttachmentTypes} from "../../utils/metricsLogger";
import {attachGenericCode, generateUrlSafeHashFromValueIdContactId} from "./genericCode";
import * as jsonschema from "jsonschema";
import log = require("loglevel");

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
            const res = await getValues(auth, {
                ...evt.queryStringParameters,
                contactId: evt.pathParameters.id
            }, Pagination.getPaginationParams(evt), showCode);

            if (evt.queryStringParameters.stats === "true") {
                // For now this is a secret param only Yervana and Chairish know about.
                await injectValueStats(auth, res.values);
            }

            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.values
            };
        });

    router.route("/v2/values/{id}/contacts")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:contacts:list");

            const res = await getContacts(auth, {
                ...evt.queryStringParameters,
                valueId: evt.pathParameters.id
            }, Pagination.getPaginationParams(evt));

            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.contacts
            };
        });

    router.route("/v2/contacts/{id}/values/attach")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            let allowOverwrite = true;
            auth.requireIds("userId", "teamMemberId");
            if (auth.hasScope("lightrailV2:values:attach:self") && auth.contactId === evt.pathParameters.id && evt.body.code && !evt.body.valueId) {
                // Badge is signed specifically to attach a value by code for this contact.
                allowOverwrite = false;
            } else {
                auth.requireScopes("lightrailV2:values:attach");
            }

            const attachSchema: jsonschema.Schema = {
                type: "object",
                additionalProperties: false,
                properties: {
                    code: {
                        type: "string",
                        minLength: 1
                    },
                    valueId: {
                        type: "string",
                        minLength: 1
                    }
                },
                oneOf: [
                    {
                        title: "attach by `valueId`",
                        required: ["valueId"]
                    },
                    {
                        title: "attach by `code`",
                        required: ["code"]
                    }
                ]
            };
            if (isYervana(auth.userId)) {
                attachSchema.properties = {
                    ...attachSchema.properties,
                    attachGenericAsNewValue: {
                        type: "boolean"
                    }
                };
            }
            evt.validateBody(attachSchema);

            return {
                body: await attachValue(auth, {
                    contactId: evt.pathParameters.id,
                    valueIdentifier: evt.body.code ? {code: evt.body.code, valueId: undefined} : {
                        code: undefined,
                        valueId: evt.body.valueId
                    },
                    attachGenericAsNewValue: evt.body.attachGenericAsNewValue,
                    allowOverwrite: allowOverwrite
                })
            };
        });

    router.route("/v2/contacts/{id}/values/detach")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:values:detach");

            evt.validateBody({
                type: "object",
                additionalProperties: false,
                properties: {
                    valueId: {
                        type: "string",
                        minLength: 1
                    }
                }
            });

            return {
                body: await detachValue(auth, evt.pathParameters.id, evt.body.valueId)
            };
        });
}

export async function attachValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, params: AttachValueParameters): Promise<Value> {
    const contact = await getContact(auth, params.contactId);
    let value = await getValueByIdentifier(auth, params.valueIdentifier);

    if (!value.active) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value cannot be attached because it is inactive.`, "ValueInactive");
    }
    if (value.frozen) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value cannot be attached because it is frozen.`, "ValueFrozen");
    }
    if (value.canceled) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value cannot be attached because it is canceled.`, "ValueCanceled");
    }
    if (value.endDate != null && value.endDate < new Date()) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value cannot be attached because it is expired.`, "ValueExpired");
    }

    if (value.isGenericCode) {
        if (isYervana(auth.userId) && !Value.isGenericCodeWithPropertiesPerContact(value) && params.attachGenericAsNewValue) {
            value = await updateYervanasGenericCodeToHavePerContactProperties(auth, value.id);
        }
        try {
            return await attachGenericCode(auth, contact.id, value);
        } catch (err) {
            if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "ValueAlreadyExists") {
                const attachedValueId = await getIdForAttachingGenericValue(auth, contact.id, value);
                log.debug("Attached Value", attachedValueId, "already exists. Will now attempt to attach Contact directly to the attached Value.");
                return await attachValue(auth, {
                    contactId: params.contactId,
                    valueIdentifier: {
                        valueId: attachedValueId,
                        code: undefined
                    },
                    allowOverwrite: params.allowOverwrite,
                });
            } else {
                throw err;
            }
        }
    } else {
        MetricsLogger.valueAttachment(ValueAttachmentTypes.Unique, auth);
        return attachUniqueValue(auth, contact.id, value, params.allowOverwrite);
    }
}

export async function detachValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, valueId: string): Promise<Value> {
    auth.requireIds("userId");
    const value = await getValue(auth, valueId);

    if (value.frozen) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value cannot be detached because it is frozen.`, "ValueFrozen");
    }

    if (!value.isGenericCode) {
        if (value.contactId !== contactId) {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value ${valueId} is not Attached to the Contact ${contactId}.`, "AttachedValueNotFound");
        }

        const now = nowInDbPrecision();
        return await updateValue(auth, valueId, {
            contactId: null,
            updatedDate: now,
            updatedContactIdDate: now
        });
    } else {
        try {
            const attachedValueId = await getIdForAttachingGenericValue(auth, contactId, value);
            const now = nowInDbPrecision();
            return await updateValue(auth, attachedValueId, {
                contactId: null,
                updatedDate: now,
                updatedContactIdDate: now
            });
        } catch (err) {
            if ((err as GiftbitRestError).statusCode === 404 && err.additionalParams.messageCode === "ValueNotFound") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value ${valueId} is not Attached to the Contact ${contactId}.`, "AttachedValueNotFound");
            } else {
                throw err;
            }
        }
    }
}

export async function getIdForAttachingGenericValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): Promise<string> {
    /* Arbitrary date set after the code for this change has been released.
       As of June 26, 2019, all attaches will use the updated hash method for generating ids for attaching generic codes.
       This code checks for whether the generic code has already been attached using the legacy id hash.

       Ideally we'll eventually be able to remove this date check. It is included so that for generic codes
       that could have used the old hashing method we can check for whether it was already attached. For generic codes
       created since June 26, 2019, we know they'll be using the updated hashing method so this skips having to make an
       additional lookup.
     */
    const createdDateCutoffForCheckingLegacyHashes = new Date("2019-06-26");

    if (genericValue.createdDate < createdDateCutoffForCheckingLegacyHashes) {
        const legacyHashId = await generateLegacyHashForValueIdContactId(genericValue.id, contactId);

        if (await valueExists(auth, legacyHashId)) {
            return legacyHashId;
        }
    }
    return generateUrlSafeHashFromValueIdContactId(genericValue.id, contactId);
}

/**
 * Legacy function for the id of the newly created Value that results from attachNewValue.
 */
export function generateLegacyHashForValueIdContactId(valueId: string, contactId: string): string {
    // Constructing the ID this way prevents the same contactId attaching
    // the Value twice and thus should not be changed.
    // Note, a problem was found that the base64 character set includes slashes which is not ideal of IDs.
    // This function needs to remain as is for idempotency reasons but a slightly different
    // implementation should be used when implementing new features.
    return crypto.createHash("sha1").update(valueId + "/" + contactId).digest("base64");
}

async function attachUniqueValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, value: Value, allowOverwrite: boolean): Promise<Value> {
    try {
        const now = nowInDbPrecision();
        const updateValues = {
            contactId: contactId,
            updatedDate: now,
            updatedContactIdDate: now
        };

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
            .update(updateValues);
        if (res === 0) {
            throw new giftbitRoutes.GiftbitRestError(409, `Value not found.`, "ValueNotFound");
        }
        if (res > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
        }
        return {
            ...value,
            ...updateValues
        };
    } catch (err) {
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "fk_Values_Contacts") {
            throw new giftbitRoutes.GiftbitRestError(404, `Contact with id '${contactId}' not found.`, "ContactNotFound");
        }
        log.error(`An unexpected error occurred while attempting to attach contactId: ${contactId} to value: ${JSON.stringify(value)}.`);
        throw err;
    }
}

function getValueByIdentifier(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueIdentifier: ValueIdentifier): Promise<Value> {
    try {
        if (valueIdentifier.valueId) {
            return getValue(auth, valueIdentifier.valueId);
        } else if (valueIdentifier.code) {
            return getValueByCode(auth, valueIdentifier.code);
        }
    } catch (err) {
        if ((err as giftbitRoutes.GiftbitRestError).isRestError && (err as giftbitRoutes.GiftbitRestError).statusCode === 404) {
            throw new giftbitRoutes.GiftbitRestError(409, (err as giftbitRoutes.GiftbitRestError).message, "ValueNotFound");
        }
    }
    throw new Error("Neither valueId nor code specified");
}

export async function hasContactValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueId: string): Promise<boolean> {
    const knex = await getKnexRead();
    const res = await knex("ContactValues")
        .count({count: "*"})
        .where({
            userId: auth.userId,
            valueId: valueId
        });
    return res[0].count >= 1;
}

function isYervana(userId: string): boolean {
    return userId === "user-eed702db18574c91b8625cec47a09ee1" || userId === "user-eed702db18574c91b8625cec47a09ee1-TEST";
}

async function updateYervanasGenericCodeToHavePerContactProperties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueId: string): Promise<Value> {
    const updates: Partial<Value> = {
        genericCodeOptions: {
            perContact: {
                usesRemaining: 1,
                balance: null, /* It's not possible to have a balance w/o a perContact.balance. */
            }
        }
    };
    return await updateValue(auth, valueId, updates);
}
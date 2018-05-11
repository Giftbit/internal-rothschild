import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";
import {getKnexWrite, getKnexRead, getSqlErrorConstraintName, upsert, getDbNowDate} from "../../dbUtils";
import {DbValueStore, ValueStore} from "../../model/ValueStore";
import {pickOrDefault} from "../../pick";

export function installValueStoresRest(router: cassava.Router): void {
    router.route("/v2/valueStores")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getValueStores(auth, getPaginationParams(evt))
            };
        });

    router.route("/v2/valueStores")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueStoreSchema);

            const now = new Date();
            now.setMilliseconds(0);
            const valueStore: ValueStore = {
                ...pickOrDefault(evt.body, {
                    valueStoreId: "",
                    valueStoreType: "",
                    currency: "",
                    value: 0,
                    pretax: false,
                    active: true,
                    frozen: false,
                    redemptionRule: null,
                    valueRule: null,
                    uses: null,
                    startDate: null,
                    endDate: null,
                    metadata: null
                }),
                expired: false,
                createdDate: now,
                updatedDate: now
            };
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createValueStore(auth, valueStore)
            };
        });

    router.route("/v2/valueStores/{valueStoreId}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            return {
                body: await getValueStore(auth, evt.pathParameters.valueStoreId)
            };
        });

    router.route("/v2/valueStores/{valueStoreId}/customer")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            return {
                body: await getValueStoreCustomer(auth, evt.pathParameters.valueStoreId)
            };
        });

    router.route("/v2/valueStores/{valueStoreId}/customer")
        .method("PUT")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            evt.validateBody({
                properties: {
                    customerId: {
                        type: "string"
                    }
                },
                required: ["customerId"]
            });

            return {
                body: await setValueStoreCustomer(auth, evt.pathParameters.valueStoreId, evt.body["customerId"])
            };
        });
}

export async function getValueStores(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams): Promise<{valueStores: ValueStore[], pagination: Pagination}> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValueStore[] = await knex("ValueStores")
        .where({
            userId: auth.giftbitUserId
        })
        .select()
        .orderBy("valueStoreId")
        .limit(pagination.limit)
        .offset(pagination.offset);
    return {
        valueStores: res.map(DbValueStore.toValueStore),
        pagination: {
            count: res.length,
            limit: pagination.limit,
            maxLimit: pagination.maxLimit,
            offset: pagination.offset
        }
    };
}

async function createValueStore(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStore: ValueStore): Promise<ValueStore> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        await knex("ValueStores")
            .insert(ValueStore.toDbValueStore(auth, valueStore));
        return valueStore;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStore with valueStoreId '${valueStore.valueStoreId}' already exists.`);
        }
        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            const constraint = getSqlErrorConstraintName(err);
            if (constraint === "valueStores_currency") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${valueStore.currency}' does not exist.  See the documentation on creating currencies.`, "CurrencyNotFound");
            }
        }
        throw err;
    }
}

async function getValueStore(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreId: string): Promise<ValueStore> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValueStore[] = await knex("ValueStores")
        .select()
        .where({
            userId: auth.giftbitUserId,
            valueStoreId
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbValueStore.toValueStore(res[0]);
}

async function getValueStoreCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreId: string): Promise<{customerId: string}> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: {customerId: string}[] = await knex("ValueStoreAccess")
        .select("customerId")
        .where({
            userId: auth.giftbitUserId,
            valueStoreId
        })
        .whereNotNull("customerId");
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return res[0];
}

async function setValueStoreCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreId: string, customerId: string): Promise<{customerId: string}> {
    auth.requireIds("giftbitUserId");

    const now = getDbNowDate();
    await upsert(
        "ValueStoreAccess",
        {
            userId: auth.giftbitUserId,
            valueStoreId,
            customerId,
            updatedDate: now
        },
        {
            userId: auth.giftbitUserId,
            valueStoreId,
            customerId,
            createdDate: now,
            updatedDate: now
        });
    return {customerId};
}

const valueStoreSchema: jsonschema.Schema = {
    type: "object",
    properties: {
        valueStoreId: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        valueStoreType: {
            type: "string",
            enum: ["GIFTCARD", "ACCOUNT_CREDIT", "PROMOTION"]
        },
        currency: {
            type: "string",
            minLength: 3,
            maxLength: 16
        },
        value: {
            type: ["number", "null"]
        },
        pretax: {
            type: "boolean"
        },
        active: {
            type: "boolean"
        },
        expired: {
            type: "boolean"
        },
        frozen: {
            type: "boolean"
        },
        redemptionRule: {
            oneOf: [
                {
                    type: "null"
                },
                {
                    title: "Redemption rule",
                    type: "object",
                    properties: {
                        rule: {
                            type: "string"
                        },
                        explanation: {
                            type: "string"
                        }
                    }
                }
            ]
        },
        valueRule: {
            oneOf: [
                {
                    type: "null"
                },
                {
                    title: "Value rule",
                    type: "object",
                    properties: {
                        rule: {
                            type: "string"
                        },
                        explanation: {
                            type: "string"
                        }
                    }
                }
            ]
        },
        uses: {
            type: ["number", "null"]
        },
        startDate: {
            type: ["string", "null"],
            format: "date-time"
        },
        endDate: {
            type: ["string", "null"],
            format: "date-time"
        }
    },
    required: ["valueStoreId", "currency"]
};

import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {getKnexWrite, getKnexRead, getSqlErrorConstraintName, upsert, nowInDbPrecision} from "../../dbUtils";
import {DbValue, Value} from "../../model/Value";
import {pickOrDefault} from "../../pick";
import {csvSerializer} from "../../serializers";

export function installValueStoresRest(router: cassava.Router): void {
    router.route("/v2/values")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const res = await getValueStores(auth, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(res.pagination),
                body: res.valueStores
            };
        });

    router.route("/v2/values")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueStoreSchema);

            const now = nowInDbPrecision();
            const value: Value = {
                ...pickOrDefault(evt.body, {
                    id: "",
                    currency: "",
                    balance: 0,
                    uses: null,
                    code: null,
                    contact: null,
                    pretax: false,
                    active: true,
                    frozen: false,
                    redemptionRule: null,
                    valueRule: null,
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
                body: await createValueStore(auth, value)
            };
        });

    router.route("/v2/values/{valueStoreId}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            return {
                body: await getValueStore(auth, evt.pathParameters.valueStoreId)
            };
        });

    router.route("/v2/values/{valueStoreId}/customer")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            return {
                body: await getValueStoreCustomer(auth, evt.pathParameters.valueStoreId)
            };
        });

    router.route("/v2/values/{valueStoreId}/customer")
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

export async function getValueStores(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams): Promise<{valueStores: Value[], pagination: Pagination}> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("ValueStores")
        .where({
            userId: auth.giftbitUserId
        })
        .select()
        .orderBy("valueStoreId")
        .limit(pagination.limit)
        .offset(pagination.offset);
    return {
        valueStores: res.map(DbValue.toValue),
        pagination: {
            limit: pagination.limit,
            maxLimit: pagination.maxLimit,
            offset: pagination.offset
        }
    };
}

async function createValueStore(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStore: Value): Promise<Value> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        await knex("ValueStores")
            .insert(Value.toDbValue(auth, valueStore));
        return valueStore;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStore with valueStoreId '${valueStore.id}' already exists.`);
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

async function getValueStore(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreId: string): Promise<Value> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("ValueStores")
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
    return DbValue.toValue(res[0]);
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

    const now = nowInDbPrecision();
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
        id: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        currency: {
            type: "string",
            minLength: 3,
            maxLength: 16
        },
        balance: {
            type: ["number", "null"]
        },
        uses: {
            type: ["number", "null"]
        },
        code: {
            type: "string",
            minLength: 1,
            maxLength: 255
        },
        contact: {
            type: "string",
            minLength: 1,
            maxLength: 255
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

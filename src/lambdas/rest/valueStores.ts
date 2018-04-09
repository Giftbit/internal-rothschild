import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";
import {getKnexWrite, getKnexRead} from "../../dbUtils";
import {ValueStore} from "../../model/ValueStore";
import {DbValueStore} from "../../dbmodel/DbValueStore";

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
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createValueStore(auth, {
                    valueStoreId: evt.body.valueStoreId,
                    valueStoreType: evt.body.valueStoreType,
                    currency: evt.body.currency,
                    value: evt.body.value != null ? evt.body.value : 0,
                    pretax: evt.body.pretax != null ? evt.body.pretax : false,
                    active: evt.body.active != null ? evt.body.active : true,
                    expired: false,
                    frozen: evt.body.frozen != null ? evt.body.frozen : false,
                    redemptionRule: evt.body.redemptionRule || null,
                    valueRule: evt.body.valueRule || null,
                    usesLeft: evt.body.usesLeft != null ? evt.body.usesLeft : null,
                    startDate: evt.body.startDate != null ? evt.body.startDate : null,
                    endDate: evt.body.endDate != null ? evt.body.endDate : null,
                    metadata: evt.body.metadata !== undefined ? evt.body.metadata : null,
                    createdDate: now,
                    updatedDate: now
                })
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
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStore with valueStoreId '${valueStore.valueStoreId}' already exists.`);
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
            maxLength: 16
        },
        value: {
            type: ["number", "null"]
        },
        preTax: {
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
        usesLeft: {
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

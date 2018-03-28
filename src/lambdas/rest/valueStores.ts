import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";
import {SqlSelectResponse} from "../../sqlResponses";
import {withDbConnection, withDbReadConnection} from "../../dbUtils";
import {ValueStore} from "../../model/ValueStore";
import {Customer} from "../../model/Customer";

export function installValueStoresRest(router: cassava.Router): void {
    router.route("/v2/valueStores")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getValueStores(auth.giftbitUserId, getPaginationParams(evt))
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
                body: await createValueStore({
                    userId: auth.giftbitUserId,
                    valueStoreId: evt.body.valueStoreId,
                    valueStoreType: evt.body.valueStoreType,
                    currency: evt.body.currency,
                    createdDate: now,
                    updatedDate: now,
                    value: evt.body.value != null ? evt.body.value : 0,
                    active: evt.body.active != null ? evt.body.active : true,
                    expired: false,
                    frozen: evt.body.frozen != null ? evt.body.frozen : false,
                    redemptionRule: evt.body.redemptionRule || null,
                    valueRule: evt.body.valueRule || null,
                    usesLeft: evt.body.usesLeft != null ? evt.body.usesLeft : null,
                    startDate: evt.body.startDate != null ? evt.body.startDate : null,
                    endDate: evt.body.endDate != null ? evt.body.endDate : null
                })
            };
        });
}

async function getValueStores(userId: string, pagination: PaginationParams): Promise<{valueStores: ValueStore[], pagination: Pagination}> {
    return withDbReadConnection(async conn => {
        const res: SqlSelectResponse<ValueStore> = await conn.query(
            "SELECT * FROM ValueStores WHERE userId = ? ORDER BY valueStoreId LIMIT ?,?",
            [userId, pagination.offset, pagination.limit]
        );
        return {
            valueStores: res,
            pagination: {
                count: res.length,
                limit: pagination.limit,
                maxLimit: pagination.maxLimit,
                offset: pagination.offset
            }
        };
    });
}

async function createValueStore(valueStore: ValueStore): Promise<ValueStore> {
    return withDbConnection<ValueStore>(async conn => {
        try {
            // This feels like a lot of work.  :/
            await conn.query(
                "INSERT INTO ValueStores (userId, valueStoreId, valueStoreType, currency, createdDate, updatedDate, value, active,expired, frozen, redemptionRule, valueRule, usesLeft, startDate, endDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [valueStore.userId, valueStore.valueStoreId, valueStore.valueStoreType, valueStore.currency, valueStore.createdDate, valueStore.updatedDate, valueStore.value, valueStore.active, valueStore.expired, valueStore.frozen, JSON.stringify(valueStore.redemptionRule), JSON.stringify(valueStore.valueRule), valueStore.usesLeft, valueStore.startDate, valueStore.endDate]
            );
            return valueStore;
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStore with valueStoreId '${valueStore.valueStoreId}' already exists.`);
            }
            throw err;
        }
    });
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

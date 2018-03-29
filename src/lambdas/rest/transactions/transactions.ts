import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {OrderRequest, TransactionParty} from "../../../model/TransactionRequest";

export function installTransactionsRest(router: cassava.Router): void {
    router.route("/v2/transactions/order")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(orderSchema);
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createOrder(auth.giftbitUserId, evt.body)
            };
        });
}

async function createOrder(userId: string, order: OrderRequest): Promise<any> {
    const parties = await resolveParties(order.sources);
    // build transaction plan
    // run transaction plan
}

async function resolveParties(parties: TransactionParty[]): Promise<TransactionParty[]> {
    const resolvedParties: TransactionParty[] = [];
    for (const party of parties) {
        switch (party.rail) {
            case "lightrail":
                if (party.customerId) {
                    throw new cassava.RestError(500, "lightrail customerId isn't supported yet");
                    // TODO look up in value store access
                } else if (party.code) {
                    throw new cassava.RestError(500, "lightrail code isn't supported yet");
                    // TODO look up in value store access
                } else if (party.valueStoreId) {
                    resolvedParties.push(party);
                } else {
                    throw new Error(`Unhandled lightrail transaction party: ${JSON.stringify(party)}`);
                }
                break;
            case "stripe":
                resolvedParties.push(party);
                break;
            case "internal":
                resolvedParties.push(party);
                break;
        }
    }
    return resolvedParties;
}

const lightrailPartySchema: jsonschema.Schema = {
    title: "lightrail",
    type: "object",
    properties: {
        rail: {
            type: "string",
            enum: ["lightrail"]
        }
    },
    oneOf: [
        {
            properties: {
                customerId: {
                    type: "string"
                }
            },
            required: ["customerId"]
        },
        {
            properties: {
                code: {
                    type: "string"
                }
            },
            required: ["code"]
        },
        {
            properties: {
                valueStoreId: {
                    type: "string"
                }
            },
            required: ["valueStoreId"]
        }
    ],
    required: ["rail"]
};

const stripePartySchema: jsonschema.Schema = {
    title: "stripe",
    type: "object",
    properties: {
        rail: {
            type: "string",
            enum: ["stripe"]
        },
        token: {
            type: "string"
        }
    },
    required: ["rail"]
};

const internalPartySchema: jsonschema.Schema = {
    title: "internal",
    type: "object",
    properties: {
        rail: {
            type: "string",
            enum: ["internal"]
        },
        id: {
            type: "string"
        },
        value: {
            type: "integer",
            minimum: 0
        },
        appliedFirst: {
            type: "boolean"
        }
    },
    required: ["rail", "id", "value"]
};

const orderSchema: jsonschema.Schema = {
    type: "object",
    properties: {
        transactionId: {
            type: "string"
        },
        cart: {
            type: "object"
        },
        currency: {
            type: "string"
        },
        sources: {
            type: "array",
            items: {
                oneOf: [
                    lightrailPartySchema,
                    stripePartySchema,
                    internalPartySchema
                ]
            }
        }
    },
    required: ["transactionId", "cart", "currency"]
};

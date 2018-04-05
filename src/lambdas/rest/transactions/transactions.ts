import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {
    InternalTransactionParty, LightrailTransactionParty, OrderRequest, StripeTransactionParty,
    TransactionParty
} from "../../../model/TransactionRequest";
import {ValueStore} from "../../../model/ValueStore";
import {getKnex, getKnexRead} from "../../../dbUtils";

export function installTransactionsRest(router: cassava.Router): void {
    router.route("/v2/transactions/order")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(orderSchema);
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createOrder(auth, evt.body)
            };
        });
}

async function createOrder(auth: giftbitRoutes.jwtauth.AuthorizationBadge, order: OrderRequest): Promise<any> {
    const parties = await resolveParties(auth, order.sources);
    // build transaction plan
    // run transaction plan
}

async function resolveParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, parties: TransactionParty[]): Promise<{lightrail: ValueStore[], internal: InternalTransactionParty[], stripe: StripeTransactionParty[]}> {
    const lightrailValueStoreIds = parties.filter(p => p.rail === "lightrail" && p.valueStoreId).map(p => (p as LightrailTransactionParty).valueStoreId);
    const lightrailCodes = parties.filter(p => p.rail === "lightrail" && p.code).map(p => (p as LightrailTransactionParty).code);
    const lightrailCustomerIds = parties.filter(p => p.rail === "lightrail" && p.customerId).map(p => (p as LightrailTransactionParty).customerId);

    let lightrail: ValueStore[] = [];
    if (lightrailValueStoreIds.length || lightrailCodes.length || lightrailCustomerIds.length) {
        const knex = await getKnexRead();
        lightrail = await knex("ValueStores")
            .where({userId: auth.giftbitUserId})
            .andWhere(function () {
                // This is a fairly advanced subquery where I'm doing things conditionally.
                let query = this;
                if (lightrailValueStoreIds.length) {
                    query = query.orWhereIn("valueStoreId", lightrailValueStoreIds);
                }
                if (lightrailCodes.length) {
                    // TODO join on value store access
                    throw new cassava.RestError(500, "lightrail code isn't supported yet");
                }
                if (lightrailCustomerIds.length) {
                    // TODO join on value store access
                    throw new cassava.RestError(500, "lightrail customerId isn't supported yet");
                }
                return query;
            })
            .select();
    }

    // Internal doesn't need any further processing.
    const internal = parties.filter(p => p.rail === "internal") as InternalTransactionParty[];

    // I don't think Stripe needs more processing but if it did that would happen here.
    const stripe = parties.filter(p => p.rail === "stripe") as StripeTransactionParty[];

    return {
        lightrail,
        internal,
        stripe
    };
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

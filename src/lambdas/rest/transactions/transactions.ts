import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {compareTransactionPlanSteps} from "./compareTransactionPlanSteps";
import {
    CreditRequest,
    DebitRequest,
    OrderRequest,
    TransferRequest
} from "../../../model/TransactionRequest";
import {resolveTransactionParties} from "./resolveTransactionParties";
import {buildOrderTransactionPlan} from "./buildOrderTransactionPlan";
import {Transaction} from "../../../model/Transaction";
import {executeTransactionPlanner} from "./executeTransactionPlan";
import {LightrailTransactionPlanStep} from "./TransactionPlan";

export function installTransactionsRest(router: cassava.Router): void {
    router.route("/v2/transactions/credit")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(creditSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createCredit(auth, evt.body)
            };
        });

    router.route("/v2/transactions/debit")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(debitSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createDebit(auth, evt.body)
            };
        });

    router.route("/v2/transactions/order")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(orderSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createOrder(auth, evt.body)
            };
        });

    router.route("/v2/transactions/transfer")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(transferSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createTransfer(auth, evt.body)
            };
        });
}

async function createCredit(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CreditRequest): Promise<Transaction> {
    return await executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: false
        },
        async () => {
            const parties = await resolveTransactionParties(auth, req.currency, [req.destination]);
            if (parties.length !== 1 || parties[0].rail !== "lightrail") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the destination to a transactable Value.", "InvalidParty");
            }

            return {
                id: req.id,
                transactionType: "credit",
                steps: [
                    {
                        rail: "lightrail",
                        value: (parties[0] as LightrailTransactionPlanStep).value,
                        amount: req.amount
                    }
                ],
                remainder: 0
            };
        }
    );
}

async function createDebit(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: DebitRequest): Promise<Transaction> {
    return await executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: req.allowRemainder
        },
        async () => {
            const parties = await resolveTransactionParties(auth, req.currency, [req.source]);
            if (parties.length !== 1 || parties[0].rail !== "lightrail") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the source to a transactable Value.", "InvalidParty");
            }

            const amount = Math.min(req.amount, (parties[0] as LightrailTransactionPlanStep).value.balance);
            return {
                id: req.id,
                transactionType: "debit",
                steps: [
                    {
                        rail: "lightrail",
                        value: (parties[0] as LightrailTransactionPlanStep).value,
                        amount: -amount
                    }
                ],
                remainder: req.amount - amount
            };
        }
    );
}

async function createOrder(auth: giftbitRoutes.jwtauth.AuthorizationBadge, order: OrderRequest): Promise<Transaction> {
    return executeTransactionPlanner(
        auth,
        {
            simulate: order.simulate,
            allowRemainder: order.allowRemainder
        },
        async () => {
            const steps = await resolveTransactionParties(auth, order.currency, order.sources);
            steps.sort(compareTransactionPlanSteps);
            return buildOrderTransactionPlan(order, steps);
        }
    );
}

async function createTransfer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: TransferRequest): Promise<Transaction> {
    return executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: req.allowRemainder
        },
        async () => {
            const sourceParties = await resolveTransactionParties(auth, req.currency, [req.source]);
            if (sourceParties.length !== 1 || sourceParties[0].rail !== "lightrail") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the source to a transactable Value.", "InvalidParty");
            }

            const destParties = await resolveTransactionParties(auth, req.currency, [req.destination]);
            if (destParties.length !== 1 || destParties[0].rail !== "lightrail") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the destination to a transactable Value.", "InvalidParty");
            }

            const amount = Math.min(req.amount, (sourceParties[0] as LightrailTransactionPlanStep).value.balance);
            return {
                id: req.id,
                transactionType: "transfer",
                steps: [
                    {
                        rail: "lightrail",
                        value: (sourceParties[0] as LightrailTransactionPlanStep).value,
                        amount: -amount
                    },
                    {
                        rail: "lightrail",
                        value: (destParties[0] as LightrailTransactionPlanStep).value,
                        amount
                    }
                ],
                remainder: req.amount - amount
            };
        }
    );
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
                contactId: {
                    type: "string"
                }
            },
            required: ["contactId"]
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
                valueId: {
                    type: "string"
                }
            },
            required: ["valueId"]
        }
    ],
    required: ["rail"]
};

/**
 * Can only refer to a single value store.
 */
const lightrailUniquePartySchema: jsonschema.Schema = {
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
                code: {
                    type: "string"
                }
            },
            required: ["code"]
        },
        {
            properties: {
                valueId: {
                    type: "string"
                }
            },
            required: ["valueId"]
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
        beforeLightrail: {
            type: "boolean"
        }
    },
    required: ["rail", "id", "value"]
};

const creditSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    properties: {
        id: {
            type: "string",
            minLength: 1
        },
        destination: lightrailUniquePartySchema,
        amount: {
            type: "integer",
            minimum: 1
        },
        currency: {
            type: "string",
            minLength: 3,
            maxLength: 16
        },
        simulate: {
            type: "boolean"
        }
    },
    required: ["id", "destination", "amount", "currency"]
};

const debitSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    properties: {
        id: {
            type: "string",
            minLength: 1
        },
        source: lightrailUniquePartySchema,
        amount: {
            type: "integer",
            minimum: 1
        },
        currency: {
            type: "string",
            minLength: 3,
            maxLength: 16
        },
        simulate: {
            type: "boolean"
        },
        allowRemainder: {
            type: "boolean"
        }
    },
    required: ["id", "source", "amount", "currency"]
};

const transferSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    properties: {
        id: {
            type: "string",
            minLength: 1
        },
        source: lightrailUniquePartySchema,
        destination: lightrailUniquePartySchema,
        amount: {
            type: "integer",
            minimum: 1
        },
        currency: {
            type: "string",
            minLength: 3,
            maxLength: 16
        },
        simulate: {
            type: "boolean"
        },
        allowRemainder: {
            type: "boolean"
        }
    },
    required: ["id", "source", "amount", "currency"]
};

const orderSchema: jsonschema.Schema = {
    title: "order",
    type: "object",
    properties: {
        id: {
            type: "string",
            minLength: 1
        },
        cart: {
            type: "object"
        },
        currency: {
            type: "string",
            minLength: 3,
            maxLength: 16
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
        },
        simulate: {
            type: "boolean"
        },
        allowRemainder: {
            type: "boolean"
        }
    },
    required: ["id", "cart", "currency", "sources"]
};

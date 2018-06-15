import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {CheckoutRequest, CreditRequest, DebitRequest, TransferRequest} from "../../../model/TransactionRequest";
import {resolveTransactionParties} from "./resolveTransactionParties";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {executeTransactionPlanner} from "./executeTransactionPlan";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {getKnexRead} from "../../../dbUtils/connection";
import {Filters, TransactionFilterParams} from "../../../model/Filter";
import {paginateQuery} from "../../../dbUtils/paginateQuery";
import {LightrailTransactionPlanStep} from "./TransactionPlan";
import {optimizeCheckout} from "./checkoutTransactionPlanner";
import getPaginationParams = Pagination.getPaginationParams;
import getTransactionFilterParams = Filters.getTransactionFilterParams;

export function installTransactionsRest(router: cassava.Router): void {
    router.route("/v2/transactions")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const res = await getTransactions(auth, getPaginationParams(evt), getTransactionFilterParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.transactions
            };
        });

    router.route("/v2/transactions/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getTransaction(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/transactions/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.FORBIDDEN, "Cannot modify transactions.", "CannotModifyTransaction");
        });

    router.route("/v2/transactions/{id}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.FORBIDDEN, "Cannot delete transactions.", "CannotDeleteTransaction");
        });

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

    router.route("/v2/transactions/checkout")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(checkoutSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createCheckout(auth, evt.body)
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

async function getTransactions(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams, filter: TransactionFilterParams): Promise<{ transactions: Transaction[], pagination: Pagination }> {
    auth.requireIds("giftbitUserId");
    const knex = await getKnexRead();

    let query = knex("Transactions")
        .select()
        .where({
            userId: auth.giftbitUserId
        });

    if (filter.transactionType) {
        query.where("transactionType", filter.transactionType);
    }
    if (filter.minCreatedDate) {
        query.where("createdDate", ">", filter.minCreatedDate);
    }
    if (filter.maxCreatedDate) {
        query.where("createdDate", "<", filter.maxCreatedDate);
    }

    if (!pagination.sort) {     // TODO should we be more prescriptive about this?
        pagination.sort = {
            field: "createdDate",
            asc: true
        };
    }

    const paginatedRes = await paginateQuery<DbTransaction>(
        query,
        pagination
    );

    const transacs: Transaction[] = await Promise.all(await DbTransaction.toTransactions(paginatedRes.body, auth.giftbitUserId));

    return {
        transactions: transacs,
        pagination: paginatedRes.pagination
    };
}

export async function getTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Transaction> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbTransaction[] = await knex("Transactions")
        .select()
        .where({
            userId: auth.giftbitUserId,
            id
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    const transacs: Transaction[] = await Promise.all(await DbTransaction.toTransactions(res, auth.giftbitUserId));
    return transacs[0];   // at this point there will only ever be one
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
                currency: req.currency,
                steps: [
                    {
                        rail: "lightrail",
                        value: (parties[0] as LightrailTransactionPlanStep).value,
                        amount: req.amount
                    }
                ],
                metadata: req.metadata,
                totals: {remainder: 0},
                lineItems: null,
                paymentSources: null
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
                currency: req.currency,
                steps: [
                    {
                        rail: "lightrail",
                        value: (parties[0] as LightrailTransactionPlanStep).value,
                        amount: -amount
                    }
                ],
                metadata: req.metadata,
                totals: {remainder: req.amount - amount},
                lineItems: null,
                paymentSources: null  // TODO need to make sense of 'source' in req vs 'paymentSources' in db
            };
        }
    );
}

async function createCheckout(auth: giftbitRoutes.jwtauth.AuthorizationBadge, checkout: CheckoutRequest): Promise<Transaction> {
    return executeTransactionPlanner(
        auth,
        {
            simulate: checkout.simulate,
            allowRemainder: checkout.allowRemainder
        },
        async () => {
            const steps = await resolveTransactionParties(auth, checkout.currency, checkout.sources);
            // TODO - suggestion is we rip all of this out.
            // let preTaxSteps: TransactionPlanStep[] = [];
            // let postTaxSteps: TransactionPlanStep[] = [];
            //
            // // todo - need to look into this. internal can be pretax. why doesn't lightrail transaction plan step have pretax flag?
            // for (const step of steps) {
            //     if (step.rail === "lightrail" && step.value.pretax) {
            //         preTaxSteps.push(step);
            //     } else {
            //         postTaxSteps.push(step);
            //     }
            // }
            //
            // preTaxSteps = preTaxSteps.sort(compareTransactionPlanSteps);
            // postTaxSteps = postTaxSteps.sort(compareTransactionPlanSteps);
            // console.log(`preTaxSteps: ${JSON.stringify(preTaxSteps)}`);
            // console.log(`postTaxSteps: ${JSON.stringify(postTaxSteps)}`);
            return optimizeCheckout(checkout, steps);
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
                currency: req.currency,
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
                metadata: req.metadata,
                totals: {remainder: req.amount - amount},
                lineItems: null,
                paymentSources: null  // TODO need to make sense of 'source' in req vs 'paymentSources' in db
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

const checkoutSchema: jsonschema.Schema = {
    title: "checkout",
    type: "object",
    properties: {
        id: {
            type: "string",
            minLength: 1
        },
        lineItems: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        enum: ["product", "shipping", "fee"]
                    },
                    productId: {
                        type: "string"
                    },
                    unitPrice: {
                        type: "integer",
                        minimum: 0
                    },
                    quantity: {
                        type: "integer",
                        minimum: 1
                    }
                },
                required: ["unitPrice"],
                minItems: 1
            }
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
    required: ["id", "lineItems", "currency", "sources"]
};

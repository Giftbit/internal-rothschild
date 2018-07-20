import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {CheckoutRequest, CreditRequest, DebitRequest, TransferRequest} from "../../../model/TransactionRequest";
import {resolveTransactionParties} from "./resolveTransactionParties";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {executeTransactionPlanner} from "./executeTransactionPlan";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import {Filters, TransactionFilterParams} from "../../../model/Filter";
import {paginateQuery} from "../../../utils/dbUtils/paginateQuery";
import {LightrailTransactionPlanStep} from "./TransactionPlan";
import {optimizeCheckout} from "./checkout/checkoutTransactionPlanner";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {createTransferTransactionPlan, resolveTransferTransactionParties} from "./transferTransactionPlanner";
import getPaginationParams = Pagination.getPaginationParams;
import getTransactionFilterParams = Filters.getTransactionFilterParams;

export function installTransactionsRest(router: cassava.Router): void {
    router.route("/v2/transactions")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            auth.requireScopes("lightrailV2:transactions:list");
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
            auth.requireScopes("lightrailV2:transactions:read");
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
            auth.requireScopes("lightrailV2:transactions:credit");
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
            auth.requireScopes("lightrailV2:transactions:debit");
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
            auth.requireScopes("lightrailV2:transactions:checkout");
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
            auth.requireScopes("lightrailV2:transactions:transfer");
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
            const parties = await resolveTransactionParties(auth, req.currency, [req.destination], req.id);
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
                createdDate: nowInDbPrecision(),
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
            const parties = await resolveTransactionParties(auth, req.currency, [req.source], req.id);
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
                createdDate: nowInDbPrecision(),
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
            const steps = await resolveTransactionParties(auth, checkout.currency, checkout.sources, checkout.id);
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
            const parties = await resolveTransferTransactionParties(auth, req);
            return await createTransferTransactionPlan(req, parties);
        }
    );
}

const lightrailPartySchema: jsonschema.Schema = {
    title: "lightrail",
    type: "object",
    additionalProperties: false,
    properties: {
        rail: {
            type: "string",
            enum: ["lightrail"]
        },
        contactId: {
            type: "string"
        },
        code: {
            type: "string"
        },
        valueId: {
            type: "string"
        }
    },
    oneOf: [
        {
            required: ["contactId"]
        },
        {
            required: ["code"]
        },
        {
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
    additionalProperties: false,
    properties: {
        rail: {
            type: "string",
            enum: ["lightrail"]
        },
        code: {
            type: "string"
        },
        valueId: {
            type: "string"
        }
    },
    oneOf: [
        {
            required: ["code"]
        },
        {
            required: ["valueId"]
        }
    ],
    required: ["rail"]
};

const stripePartySchema: jsonschema.Schema = {
    title: "stripe",
    type: "object",
    additionalProperties: false,
    properties: {
        rail: {
            type: "string",
            enum: ["stripe"]
        },
        source: {
            type: "string"
        },
        customer: {
            type: "string"
        },
        maxAmount: {
            type: "integer"
        }
    },
    oneOf: [
        {
            required: ["source"]
        },
        {
            required: ["customer"]
        }
    ],
    required: ["rail"]
};

const internalPartySchema: jsonschema.Schema = {
    title: "internal",
    type: "object",
    additionalProperties: false,
    properties: {
        rail: {
            type: "string",
            enum: ["internal"]
        },
        internalId: {
            type: "string"
        },
        balance: {
            type: "integer",
            minimum: 0
        },
        beforeLightrail: {
            type: "boolean"
        },
        pretax: {
            type: "boolean"
        }
    },
    required: ["rail", "internalId", "balance"]
};

const creditSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    additionalProperties: false,
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
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id", "destination", "amount", "currency"]
};

const debitSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    additionalProperties: false,
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
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id", "source", "amount", "currency"]
};

const transferSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            minLength: 1
        },
        source: {
            oneOf: [
                lightrailPartySchema,
                stripePartySchema
            ]
        }
        ,
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
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id", "source", "amount", "currency"]
};

const checkoutSchema: jsonschema.Schema = {
    title: "checkout",
    type: "object",
    additionalProperties: false,
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
                    },
                    taxRate: {
                        type: "float",
                        minimum: 0
                    },
                    marketplaceRate: {
                        type: "float",
                        minimum: 0,
                        maximum: 1
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
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id", "lineItems", "currency", "sources"]
};

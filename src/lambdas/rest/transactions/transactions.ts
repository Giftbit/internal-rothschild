import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import * as pendingTransactionUtils from "./pendingTransactionUtils";
import {resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";
import {
    CaptureRequest,
    CheckoutRequest,
    CreditRequest,
    DebitRequest,
    ReverseRequest,
    TransferRequest,
    VoidRequest
} from "../../../model/TransactionRequest";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {executeTransactionPlanner} from "./executeTransactionPlan";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import {optimizeCheckout} from "./checkout/checkoutTransactionPlanner";
import {filterAndPaginateQuery} from "../../../utils/dbUtils";
import {createTransferTransactionPlan, resolveTransferTransactionPlanSteps} from "./transactions.transfer";
import {createCreditTransactionPlan} from "./transactions.credit";
import {createDebitTransactionPlan} from "./transactions.debit";
import {createReverseTransactionPlan} from "./reverse/transactions.reverse";
import {createCaptureTransactionPlan} from "./transactions.capture";
import {createVoidTransactionPlan} from "./transactions.void";
import getPaginationParams = Pagination.getPaginationParams;

export function installTransactionsRest(router: cassava.Router): void {
    router.route("/v2/transactions")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:list");
            const res = await getTransactions(auth, evt.queryStringParameters, getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.transactions
            };
        });

    router.route("/v2/transactions/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:read");
            return {
                body: await getTransaction(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/transactions/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.FORBIDDEN, "Cannot modify transactions.", "CannotModifyTransaction");
        });

    router.route("/v2/transactions/{id}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.FORBIDDEN, "Cannot delete transactions.", "CannotDeleteTransaction");
        });

    router.route("/v2/transactions/credit")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
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
            auth.requireIds("userId", "teamMemberId");
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
            auth.requireIds("userId", "teamMemberId");
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
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:transactions:transfer");
            evt.validateBody(transferSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createTransfer(auth, evt.body)
            };
        });

    router.route("/v2/transactions/{id}/reverse")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:transactions:reverse");
            evt.validateBody(reverseSchema);
            return {
                statusCode: evt.body.simulate ? cassava.httpStatusCode.success.OK : cassava.httpStatusCode.success.CREATED,
                body: await createReverse(auth, evt.body, evt.pathParameters.id)
            };
        });

    router.route("/v2/transactions/{id}/capture")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:transactions:capture");
            evt.validateBody(captureSchema);
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createCapture(auth, evt.body, evt.pathParameters.id)
            };
        });

    router.route("/v2/transactions/{id}/void")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:transactions:void");
            evt.validateBody(voidSchema);
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createVoid(auth, evt.body, evt.pathParameters.id)
            };
        });

    router.route("/v2/transactions/{id}/chain")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:read");
            const dbTransaction = await getDbTransaction(auth, evt.pathParameters.id);
            evt.queryStringParameters["rootTransactionId"] = dbTransaction.rootTransactionId;
            const res = await getTransactions(auth, evt.queryStringParameters, getPaginationParams(evt, {
                sort: {
                    field: "createdDate",
                    asc: true
                }
            }));

            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.transactions
            };
        });
}

export async function getTransactions(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams): Promise<{ transactions: Transaction[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const valueId = filterParams["valueId"];
    const contactId = filterParams["contactId"];
    let query = knex("Transactions")
        .select("Transactions.*")
        .where("Transactions.userId", "=", auth.userId);
    if (valueId || contactId) {
        query.join("LightrailTransactionSteps", {
            "Transactions.id": "LightrailTransactionSteps.transactionId",
            "Transactions.userId": "LightrailTransactionSteps.userId"
        });
        if (valueId) {
            query.where("LightrailTransactionSteps.valueId", "=", valueId);
        }
        if (contactId) {
            query.where("LightrailTransactionSteps.contactId", "=", contactId);
            query.groupBy("Transactions.id"); // A Contact may have two steps in the same Transaction.
        }
    }

    const res = await filterAndPaginateQuery<DbTransaction>(
        query,
        filterParams,
        {
            properties: {
                "id": {
                    type: "string",
                    operators: ["eq", "in"]
                },
                "transactionType": {
                    type: "string",
                    operators: ["eq", "in"]
                },
                "createdDate": {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
                "currency": {
                    type: "string",
                    operators: ["eq", "in"]
                },
                "rootTransactionId": { // only used internally for looking up transaction chain and not exposed publicly
                    type: "string",
                    operators: ["eq", "in"]
                }
            },
            tableName: "Transactions"
        },
        pagination
    );
    return {
        transactions: await DbTransaction.toTransactions(res.body, auth.userId),
        pagination: res.pagination
    };
}

export async function getDbTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<DbTransaction> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res: DbTransaction[] = await knex("Transactions")
        .select()
        .where({
            userId: auth.userId,
            id
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return res[0];
}

export async function getTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Transaction> {
    auth.requireIds("userId");
    const dbTransaction = await getDbTransaction(auth, id);

    const transactions: Transaction[] = await DbTransaction.toTransactions([dbTransaction], auth.userId);
    return transactions[0];   // at this point there will only ever be one
}

async function createCredit(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CreditRequest): Promise<Transaction> {
    return await executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: false
        },
        async () => createCreditTransactionPlan(auth, req)
    );
}

async function createDebit(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: DebitRequest): Promise<Transaction> {
    return await executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: req.allowRemainder
        },
        async () => createDebitTransactionPlan(auth, req)
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
            const steps = await resolveTransactionPlanSteps(auth, {
                currency: checkout.currency,
                parties: checkout.sources,
                transactionId: checkout.id,
                nonTransactableHandling: "exclude",
                includeZeroBalance: !!checkout.allowRemainder,
                includeZeroUsesRemaining: !!checkout.allowRemainder
            });
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
            const parties = await resolveTransferTransactionPlanSteps(auth, req);
            return await createTransferTransactionPlan(req, parties);
        }
    );
}

export async function createReverse(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest, transactionIdToReverse: string): Promise<Transaction> {
    return executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: true
        },
        async () => {
            return await createReverseTransactionPlan(auth, req, transactionIdToReverse);
        }
    );
}

async function createCapture(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CaptureRequest, transactionIdToCapture: string): Promise<Transaction> {
    return executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: false
        },
        async () => {
            return await createCaptureTransactionPlan(auth, req, transactionIdToCapture);
        }
    );
}

export async function createVoid(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: VoidRequest, transactionIdToVoid: string): Promise<Transaction> {
    return executeTransactionPlanner(
        auth,
        {
            simulate: req.simulate,
            allowRemainder: true
        },
        async () => {
            return await createVoidTransactionPlan(auth, req, transactionIdToVoid);
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
            title: "lightrail specifies contactId",
            required: ["contactId"]
        },
        {
            title: "lightrail specifies code",
            required: ["code"]
        },
        {
            title: "lightrail specifies valueId",
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
            title: "lightrail specifies code",
            required: ["code"]
        },
        {
            title: "lightrail specifies valueId",
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
        },
        additionalStripeParams: {
            type: "object",
            properties: {
                description: {
                    type: ["string", "null"]
                },
                on_behalf_of: {
                    type: ["string", "null"]
                },
                receipt_email: {
                    type: ["string", "null"]
                },
                statement_descriptor: {
                    type: ["string", "null"]
                },
                transfer_group: {
                    type: ["string", "null"]
                }
            }
        }
    },
    anyOf: [
        {
            title: "stripe specifies source",
            required: ["source"]
        },
        {
            title: "stripe specifies customer",
            required: ["customer"]
        },
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
            type: "string",
            minLength: 1,
            maxLength: 64
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
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
        },
        destination: lightrailUniquePartySchema,
        amount: {
            type: "integer",
            minimum: 1
        },
        uses: {
            type: "integer",
            minimum: 1
        },
        currency: {
            type: "string",
            minLength: 1,
            maxLength: 16
        },
        simulate: {
            type: "boolean"
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    anyOf: [
        {
            title: "credit specifies amount",
            required: ["amount"]
        },
        {
            title: "credit specifies uses",
            required: ["uses"]
        }
    ],
    required: ["id", "destination", "currency"]
};

const debitSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
        },
        source: lightrailUniquePartySchema,
        amount: {
            type: "integer",
            minimum: 1
        },
        uses: {
            type: "integer",
            minimum: 1
        },
        currency: {
            type: "string",
            minLength: 1,
            maxLength: 16
        },
        simulate: {
            type: "boolean"
        },
        allowRemainder: {
            type: "boolean"
        },
        pending: {
            type: ["boolean", "string"],
            format: pendingTransactionUtils.durationPatternString
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    anyOf: [
        {
            title: "debit specifies amount",
            required: ["amount"]
        },
        {
            title: "debit specifies uses",
            required: ["uses"]
        }
    ],
    required: ["id", "source", "currency"]
};

const transferSchema: jsonschema.Schema = {
    title: "credit",
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
        },
        source: {
            oneOf: [
                lightrailPartySchema,
                stripePartySchema
            ]
        },
        destination: lightrailUniquePartySchema,
        amount: {
            type: "integer",
            minimum: 1
        },
        currency: {
            type: "string",
            minLength: 1,
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
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
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
            minLength: 1,
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
        tax: {
            title: "Tax Properties",
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                roundingMode: {
                    type: "string",
                    enum: ["HALF_EVEN", "HALF_UP"]
                }
            }
        },
        pending: {
            type: ["boolean", "string"],
            format: pendingTransactionUtils.durationPatternString
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id", "lineItems", "currency", "sources"]
};

const reverseSchema: jsonschema.Schema = {
    title: "reverse",
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
        },
        simulate: {
            type: "boolean"
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id"]
};

const captureSchema: jsonschema.Schema = {
    title: "capture",
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
        },
        simulate: {
            type: "boolean"
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id"]
};

const voidSchema: jsonschema.Schema = {
    title: "void",
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            minLength: 1,
            maxLength: 64,
            pattern: "^[ -~]*$"
        },
        simulate: {
            type: "boolean"
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id"]
};

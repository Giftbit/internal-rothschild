import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import * as pendingTransactionUtils from "./pendingTransactionUtils";
import {
    filterForUsedAttaches,
    getContactIdFromSources,
    getLightrailValuesForTransactionPlanSteps,
    getTransactionPlanStepsFromSources,
    ResolveTransactionPartiesOptions
} from "./resolveTransactionPlanSteps";
import {
    CaptureRequest,
    CheckoutRequest,
    CreditRequest,
    DebitRequest,
    InternalTransactionParty,
    ReverseRequest,
    StripeTransactionParty,
    TransactionParty,
    transactionPartySchema,
    TransferRequest,
    VoidRequest
} from "../../../model/TransactionRequest";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {executeTransactionPlanner} from "./executeTransactionPlans";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import {getCheckoutTransactionPlan} from "./checkout/checkoutTransactionPlanner";
import {filterAndPaginateQuery} from "../../../utils/dbUtils";
import {createTransferTransactionPlan, resolveTransferTransactionPlanSteps} from "./transactions.transfer";
import {createCreditTransactionPlan} from "./transactions.credit";
import {createDebitTransactionPlan} from "./transactions.debit";
import {createReverseTransactionPlan} from "./reverse/transactions.reverse";
import {createCaptureTransactionPlan} from "./transactions.capture";
import {createVoidTransactionPlan} from "./transactions.void";
import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {Value} from "../../../model/Value";
import {getAttachTransactionPlanForGenericCodeWithPerContactOptions} from "../genericCodeWithPerContactOptions";
import {MetricsLogger} from "../../../utils/metricsLogger";
import log = require("loglevel");
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
        transactions: await DbTransaction.toTransactionsUsingDb(res.body, auth.userId),
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
    if (res[0].id !== id) {
        MetricsLogger.caseInsensitiveRetrieval("getDbTransaction", res[0].id, id, auth);
    }
    return res[0];
}

export async function getTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Transaction> {
    auth.requireIds("userId");
    const dbTransaction = await getDbTransaction(auth, id);

    const transactions: Transaction[] = await DbTransaction.toTransactionsUsingDb([dbTransaction], auth.userId);
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
    const transaction = await executeTransactionPlanner(
        auth,
        {
            simulate: checkout.simulate,
            allowRemainder: checkout.allowRemainder
        },
        async () => {
            const resolveOptions: ResolveTransactionPartiesOptions = {
                currency: checkout.currency,
                transactionId: checkout.id,
                nonTransactableHandling: "exclude",
                includeZeroBalance: !!checkout.allowRemainder,
                includeZeroUsesRemaining: !!checkout.allowRemainder,
            };
            const fetchedValues = await getLightrailValuesForTransactionPlanSteps(auth, checkout.sources, resolveOptions);

            // handle auto attach on generic codes
            const valuesToAttach: Value[] = fetchedValues.filter(v => Value.isGenericCodeWithPropertiesPerContact(v));
            const valuesForCheckout: Value[] = fetchedValues.filter(v => valuesToAttach.indexOf(v) === -1);
            const attachTransactionPlans: TransactionPlan[] = [];
            if (valuesToAttach.length > 0) {
                attachTransactionPlans.push(...await getAutoAttachTransactionPlans(auth, valuesToAttach, valuesForCheckout, checkout.sources));
                for (const plan of attachTransactionPlans) {
                    valuesForCheckout.push((plan.steps.find(s => (s as LightrailTransactionPlanStep).action === "insert") as LightrailTransactionPlanStep).value);
                }
            }

            const checkoutTransactionPlanSteps = getTransactionPlanStepsFromSources(
                valuesForCheckout,
                checkout.sources.filter(src => src.rail !== "lightrail") as (StripeTransactionParty | InternalTransactionParty)[],
                resolveOptions
            );

            const checkoutTransactionPlan: TransactionPlan = getCheckoutTransactionPlan(checkout, checkoutTransactionPlanSteps);

            // Only persist attach transactions that were used.
            const attachTransactionsToPersist: TransactionPlan[] = filterForUsedAttaches(attachTransactionPlans, checkoutTransactionPlan);

            return [...attachTransactionsToPersist, checkoutTransactionPlan];
        }
    );
    return Array.isArray(transaction) ? transaction.find(tx => tx.transactionType === "checkout") : transaction;
}

async function getAutoAttachTransactionPlans(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valuesToAttach: Value[], valuesForCheckout: Value[], sources: TransactionParty[]): Promise<TransactionPlan[]> {
    const contactId = await getContactIdFromSources(auth, sources);
    if (!contactId) {
        throw new giftbitRoutes.GiftbitRestError(409, `Values cannot be transacted against because they must be attached to a Contact first. Alternatively, a contactId must be included a source in the checkout request.`, "ValueMustBeAttached");
    }

    const attachTransactionPlans: TransactionPlan[] = [];
    for (const genericValue of valuesToAttach) {
        if (valuesForCheckout.find(v => v.attachedFromValueId === genericValue.id)) {
            log.debug(`Skipping attaching generic value ${genericValue.id} since it's already been attached.`);
        } else {
            const transactionPlan = await getAttachTransactionPlanForGenericCodeWithPerContactOptions(auth, contactId, genericValue);
            attachTransactionPlans.push(transactionPlan);
        }
    }
    return attachTransactionPlans;
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

export function isReversible(transaction: Transaction, transactionChain: Transaction[]): boolean {
    return transaction.transactionType !== "reverse" &&
        !transaction.pending &&
        transaction.transactionType !== "void" &&
        transaction.transactionType !== "capture" &&
        !isReversed(transaction, transactionChain);
}

export function isReversed(transaction: Transaction, transactionChain: Transaction[]): boolean {
    return (!!transactionChain.find(txn => txn.transactionType === "reverse"));
}

export function isVoidable(transaction: Transaction, transactionChain: Transaction[]): boolean {
    return !!transaction.pending && !isVoided(transaction, transactionChain);
}

export function isVoided(transaction: Transaction, transactionChain: Transaction[]): boolean {
    return !!transaction.pending && !!transactionChain.find(txn => txn.transactionType === "void");
}

export function isCaptured(transaction: Transaction, transactionChain: Transaction[]): boolean {
    return !!transactionChain.find(txn => txn.transactionType === "capture");
}

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
        destination: transactionPartySchema.lightrailUnique,
        amount: {
            type: "integer",
            minimum: 1,
            maximum: 2147483647
        },
        uses: {
            type: "integer",
            minimum: 1,
            maximum: 2147483647
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
        source: transactionPartySchema.lightrailUnique,
        amount: {
            type: "integer",
            minimum: 1,
            maximum: 2147483647
        },
        uses: {
            type: "integer",
            minimum: 1,
            maximum: 2147483647
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
                transactionPartySchema.lightrail,
                transactionPartySchema.stripe
            ]
        },
        destination: transactionPartySchema.lightrailUnique,
        amount: {
            type: "integer",
            minimum: 1,
            maximum: 2147483647
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
                        minimum: 0,
                        maximum: 2147483647
                    },
                    quantity: {
                        type: "integer",
                        minimum: 1,
                        maximum: 2147483647
                    },
                    taxRate: {
                        type: "float",
                        minimum: 0,
                        maximum: 1
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
                    transactionPartySchema.lightrail,
                    transactionPartySchema.stripe,
                    transactionPartySchema.internal
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

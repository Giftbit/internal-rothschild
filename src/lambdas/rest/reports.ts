import * as cassava from "cassava";
import {csvSerializer} from "../../serializers";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {getKnexRead} from "../../utils/dbUtils/connection";
import {filterQuery} from "../../utils/dbUtils/filterQuery";
import {filterAndPaginateQuery} from "../../utils/dbUtils";
import {
    DbTransaction,
    InternalTransactionStep,
    LightrailTransactionStep,
    StripeTransactionStep,
    Transaction
} from "../../model/Transaction";
import {getValues} from "./values/values";
import getPaginationParams = Pagination.getPaginationParams;

const reportRowLimit = 10000;

export function installReportsRest(router: cassava.Router): void {
    router.route("/v2/reports/transactions")
        .method("GET")
        .serializers({"text/csv": csvSerializer})
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:list");

            if (!isRequestedLimitAcceptable(evt.queryStringParameters)) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested report row limit is too high. Please specify a limit of ${reportRowLimit} or less.`);
            } else {
                const res = await getTransactionsForReport(auth, evt.queryStringParameters, getPaginationParams(evt, {maxLimit: reportRowLimit}));
                if (!isResponseSizeAcceptable(evt.queryStringParameters, res.transactions)) {
                    throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Report query returned too many rows (maximum: ${reportRowLimit}). Please refine your request and try again.`);
                } else {
                    return {
                        headers: Pagination.toHeaders(evt, res.pagination),
                        body: res.transactions
                    };
                }
            }
        });

    router.route("/v2/reports/values")
        .method("GET")
        .serializers({"text/csv": csvSerializer})
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:list");

            if (!isRequestedLimitAcceptable(evt.queryStringParameters)) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Requested report row limit is too high. Please specify a limit of ${reportRowLimit} or less.`);
            } else {
                const res = await getValues(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt, {maxLimit: reportRowLimit}));
                if (!isResponseSizeAcceptable(evt.queryStringParameters, res.values)) {
                    throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Report query returned too many rows (maximum: ${reportRowLimit}). Please refine your request and try again.`);

                } else {
                    return {
                        headers: Pagination.toHeaders(evt, res.pagination),
                        body: res.values
                    };
                }
            }

        });
}

async function getTransactionsForReport(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams) {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    let query = knex("Transactions")
        .select("Transactions.*")
        .where("Transactions.userId", "=", auth.userId);

    if (filterParams["programId"] || filterParams["programId.eq"] || filterParams["programId.in"]) {
        query.join("LightrailTransactionSteps", {
            "Transactions.id": "LightrailTransactionSteps.transactionId",
            "Transactions.userId": "LightrailTransactionSteps.userId"
        })
            .join("Values", {
                "LightrailTransactionSteps.valueId": "Values.id"
            });
        query = filterQuery(query, filterParams, {
            properties: {
                "programId": {
                    type: "string",
                    operators: ["eq", "in"],
                    columnName: "Values.programId",
                }
            }
        });
    }

    const res = await filterAndPaginateQuery<DbTransaction>(query, filterParams, {
        properties: {
            "transactionType": {
                type: "string",
                operators: ["eq", "in"]
            },
            "createdDate": {
                type: "Date",
                operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
            },
        }
    }, pagination);

    const transactions = await DbTransaction.toTransactions(res.body, auth.userId);

    return {
        transactions: transactions.map(txn => ({
            id: txn.id,
            createdDate: txn.createdDate,
            transactionType: txn.transactionType,
            transactionAmount: addStepAmounts(txn),
            checkout_subtotal: txn.totals && txn.totals.subtotal || 0,
            checkout_tax: txn.totals && txn.totals.tax || 0,
            checkout_discountLightrail: txn.totals && txn.totals.discountLightrail || 0,
            checkout_paidLightrail: txn.totals && txn.totals.paidLightrail || 0,
            checkout_paidStripe: txn.totals && txn.totals.paidStripe || 0,
            checkout_paidInternal: txn.totals && txn.totals.paidInternal || 0,
            checkout_remainder: txn.totals && txn.totals.remainder || 0,
            marketplace_sellerNet: txn.totals && txn.totals.marketplace && txn.totals.marketplace.sellerNet || null,
            marketplace_sellerGross: txn.totals && txn.totals.marketplace && txn.totals.marketplace.sellerGross || null,
            marketplace_sellerDiscount: txn.totals && txn.totals.marketplace && txn.totals.marketplace.sellerDiscount || null,
            stepsCount: txn.steps.length,
            metadata: txn.metadata && JSON.stringify(txn.metadata).replace(",", ";"), // don't create column breaks
        })),
        pagination: res.pagination
    };
}

function isRequestedLimitAcceptable(queryStringParams: { [key: string]: string }): boolean {
    const requestedLimit = queryStringParams["limit"] && Number(queryStringParams["limit"]) || null;
    return !(requestedLimit && requestedLimit > reportRowLimit);
}

// response size is fine if it's less than the maximum, or if they requested exactly the maximum and got it
function isResponseSizeAcceptable(queryStringParams: { [key: string]: string }, queryResult: any[]): boolean {
    const requestedLimit = queryStringParams["limit"] && Number(queryStringParams["limit"]) || null;
    return !(queryResult.length >= reportRowLimit && (!requestedLimit || (requestedLimit && requestedLimit > reportRowLimit)));
}

function addStepAmounts(txn: Transaction): number {
    if (txn.transactionType === "transfer") {
        return getStepAmount(txn.steps.find(s => getStepAmount(s) > 0));
    } else {
        const amounts = txn.steps.map(step => getStepAmount(step));
        return amounts.reduce((acc, amount) => {
            return acc + amount;
        }, 0);
    }
}

function getStepAmount(step: LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep): number {
    if ((step as LightrailTransactionStep).balanceChange !== undefined) {
        return (step as LightrailTransactionStep).balanceChange;
    } else if ((step as StripeTransactionStep).amount !== undefined) {
        return (step as StripeTransactionStep).amount;
    } else if ((step as InternalTransactionStep).balanceChange !== undefined) {
        return (step as InternalTransactionStep).balanceChange;
    } else {
        return 0;
    }
}

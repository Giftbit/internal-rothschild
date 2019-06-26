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
import {ReportTransaction} from "./transactions/ReportTransaction";
import {formatObjectsAmountPropertiesForCurrencyDisplay} from "../../model/Currency";
import getPaginationParamsForReports = Pagination.getPaginationParamsForReports;

let reportRowLimit: number;

initializeReportRowLimit(10000);

/**
 * The reports endpoints currently only return text/csv responses: reporting data is typically
 * expected to be in csv format. Also, in order to return Transactions & Values in csv format
 * the objects need to be flattened which means they are structured differently from the json
 * returned by the main list endpoints (GET /v2/transactions, /v2/values).
 * Returning json from the reports endpoints would either mean duplication of the main list
 * endpoints or returning differently structured data which would be inconsistent/confusing.
 */
export function installReportsRest(router: cassava.Router): void {
    router.route("/v2/reports/transactions")
        .method("GET")
        .serializers({"text/csv": csvSerializer})
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:list");

            const paginationParams = getPaginationParamsForReports(evt, {maxLimit: reportRowLimit});
            const res = await getTransactionsForReport(auth, evt.queryStringParameters, paginationParams);
            if (!isResponseSizeAcceptable(res.transactions.length, evt.queryStringParameters, paginationParams)) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Report query returned too many rows. Please modify your request and try again.`);
            } else {

                if (evt.queryStringParameters.formatCurrencies === "true") {
                    return {
                        headers: Pagination.toHeaders(evt, res.pagination),
                        body: await formatObjectsAmountPropertiesForCurrencyDisplay(auth, res.transactions, [
                            "transactionAmount",
                            "checkout_subtotal",
                            "checkout_tax",
                            "checkout_discountLightrail",
                            "checkout_paidLightrail",
                            "checkout_paidStripe",
                            "checkout_paidInternal",
                            "checkout_remainder",
                            "marketplace_sellerNet",
                            "marketplace_sellerGross",
                            "marketplace_sellerDiscount",
                        ])
                    };
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

            const paginationParams = Pagination.getPaginationParams(evt, {maxLimit: reportRowLimit});
            const res = await getValues(auth, evt.queryStringParameters, paginationParams);
            if (!isResponseSizeAcceptable(res.values.length, evt.queryStringParameters, paginationParams)) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Report query returned too many rows. Please modify your request and try again`);
            } else {

                if (evt.queryStringParameters.formatCurrencies === "true") {
                    return {
                        headers: Pagination.toHeaders(evt, res.pagination),
                        body: await formatObjectsAmountPropertiesForCurrencyDisplay(auth, res.values, [
                            "balance",
                            "genericCodeOptions.perContact.balance"
                        ])
                    };
                } else {
                    return {
                        headers: Pagination.toHeaders(evt, res.pagination),
                        body: res.values
                    };
                }
            }

        });
}

async function getTransactionsForReport(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams): Promise<{ transactions: ReportTransaction[], pagination: Pagination }> {
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
                operators: ["eq", "gt", "gte", "lt", "lte", "ne"],
                columnName: "Transactions.createdDate"
            },
        }
    }, pagination);

    const transactions = await DbTransaction.toTransactions(res.body, auth.userId);

    return {
        transactions: transactions.map(txn => ({
            id: txn.id,
            createdDate: txn.createdDate,
            transactionType: txn.transactionType,
            currency: txn.currency,
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
        }) as ReportTransaction),
        pagination: res.pagination
    };
}

function isResponseSizeAcceptable(responseLength: number, queryStringParams: { [key: string]: string }, paginationParams: PaginationParams): boolean {
    return !(responseLength === reportRowLimit || (queryStringParams["errorOnOverLimit"] === "true" && responseLength === paginationParams.limit));
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

export function initializeReportRowLimit(limit: number): void {
    reportRowLimit = limit;
}

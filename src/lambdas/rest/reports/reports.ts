import * as cassava from "cassava";
import {RouterEvent} from "cassava";
import {csvSerializer} from "../../../utils/serializers";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {ReportTransaction} from "../transactions/ReportTransaction";
import {formatObjectsAmountPropertiesForCurrencyDisplay} from "../../../model/Currency";
import {ReportValue} from "../values/ReportValue";
import {getValuesForReport} from "./getValuesForReport";
import {getTransactionsForReport} from "./getTransactionsForReport";
import log = require("loglevel");

const reportRowLimit = 10000;

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

            const transactionResults = await getReportResults<ReportTransaction>(auth, evt, getTransactionsForReport);

            if (evt.queryStringParameters.formatCurrencies === "true") {
                return {
                    headers: Pagination.toHeaders(evt, transactionResults.pagination),
                    body: await formatObjectsAmountPropertiesForCurrencyDisplay(auth, transactionResults.results, [
                        "transactionAmount",
                        "checkout_subtotal",
                        "checkout_tax",
                        "checkout_discountLightrail",
                        "checkout_paidLightrail",
                        "checkout_paidStripe",
                        "checkout_paidInternal",
                        "checkout_remainder",
                        "checkout_forgiven",
                        "marketplace_sellerNet",
                        "marketplace_sellerGross",
                        "marketplace_sellerDiscount",
                    ])
                };
            } else {
                return {
                    headers: Pagination.toHeaders(evt, transactionResults.pagination),
                    body: transactionResults.results
                };
            }
        });

    router.route("/v2/reports/values")
        .method("GET")
        .serializers({"text/csv": csvSerializer})
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:list");

            const valueResults = await getReportResults<ReportValue>(auth, evt, getValuesForReport);

            if (evt.queryStringParameters.formatCurrencies === "true") {
                return {
                    headers: Pagination.toHeaders(evt, valueResults.pagination),
                    body: await formatObjectsAmountPropertiesForCurrencyDisplay(auth, valueResults.results, [
                        "balance",
                        "genericCodeOptions_perContact_balance"
                    ])
                };
            } else {
                return {
                    headers: Pagination.toHeaders(evt, valueResults.pagination),
                    body: valueResults.results
                };
            }
        });
}

type ReportDelegate<T> = (auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams) => Promise<{ results: T[], pagination: Pagination }>;

/**
 * Uses a delegate to actually fetch the results so we can do reports-specific things with the pagination params used in the query.
 */
async function getReportResults<T>(auth: giftbitRoutes.jwtauth.AuthorizationBadge, evt: RouterEvent, fetchObjectsDelegate: ReportDelegate<T>): Promise<{ results: T[], pagination: Pagination }> {
    const requestedLimit = +evt.queryStringParameters["limit"] || reportRowLimit;

    const paginationParams = Pagination.getPaginationParams(evt, {
        defaultLimit: requestedLimit,
        maxLimit: reportRowLimit
    });
    const res = await fetchObjectsDelegate(auth, evt.queryStringParameters, paginationParams);
    const results = res.results;

    log.info(`Report query returned ${results.length} rows. Params: requestedLimit=${requestedLimit}`);

    return {
        results: results as T[],
        pagination: res.pagination
    };
}

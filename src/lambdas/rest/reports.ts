import * as cassava from "cassava";
import {csvSerializer} from "../../serializers";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {getKnexRead} from "../../utils/dbUtils/connection";
import {filterQuery} from "../../utils/dbUtils/filterQuery";
import {filterAndPaginateQuery} from "../../utils/dbUtils";
import {DbTransaction} from "../../model/Transaction";
import {getValues} from "./values/values";
import getPaginationParams = Pagination.getPaginationParams;

export function installReportsRest(router: cassava.Router): void {
    router.route("/v2/reports/transactions")
        .method("GET")
        .serializers({"text/csv": csvSerializer})
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:list");

            const res = await getTransactionsForReport(auth, evt.queryStringParameters, getPaginationParams(evt));

            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.transactions
            };
        });

    router.route("/v2/reports/values")
        .method("GET")
        .serializers({"text/csv": csvSerializer})
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:list");

            const requestedLimit = evt.queryStringParameters["limit"] && Number(evt.queryStringParameters["limit"]) || null;
            if (requestedLimit && requestedLimit > reportRowLimit) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Requested limit of ${requestedLimit} is greater than the maximum of ${reportRowLimit}. Please specify a limit of ${reportRowLimit} or less.`);

            } else {
                const res = await getValues(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt, {maxLimit: reportRowLimit}));

                return {
                    headers: Pagination.toHeaders(evt, res.pagination),
                    body: res.values
                };
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

    const reportRowLimit = 10000;
    if (pagination.limit && pagination.limit > reportRowLimit) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Requested limit of ${pagination.limit} is greater than the maximum of ${reportRowLimit}. Please specify a limit of 10000 or less.`);
    } else if (pagination.limit && pagination.limit <= reportRowLimit) {
        query.limit(pagination.limit);
    } else {
        query.limit(reportRowLimit);
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

    if (res.body.length > reportRowLimit - 1 && pagination.limit !== reportRowLimit) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Report query returned too many rows: '${res.body.length}' is greater than the maximum of '${reportRowLimit}'. Please refine your request and try again.`);
    } else return {
        transactions: await DbTransaction.formatForReports(res.body, auth),
        pagination: res.pagination
    };
}

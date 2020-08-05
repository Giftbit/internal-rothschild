import * as giftbitRoutes from "giftbit-cassava-routes";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {ReportValue} from "../values/ReportValue";
import {getValues} from "../values/values";
import {Value} from "../../../model/Value";

export async function getValuesForReport(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams, showCode: boolean = false): Promise<{ results: ReportValue[], pagination: Pagination }> {
    const res = await getValues(auth, filterParams, pagination, showCode);
    return {
        results: res.values.map((v): ReportValue => {
            const results = {
                ...v,
                genericCodeOptions_perContact_balance: Value.isGenericCodeWithPropertiesPerContact(v) ? v.genericCodeOptions.perContact.balance : null,
                genericCodeOptions_perContact_usesRemaining: Value.isGenericCodeWithPropertiesPerContact(v) ? v.genericCodeOptions.perContact.usesRemaining : null,
            };
            delete results.genericCodeOptions;
            return results;
        }),
        pagination: res.pagination
    };
}

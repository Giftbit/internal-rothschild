import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    InternalTransactionParty, LightrailTransactionParty, StripeTransactionParty,
    TransactionParty
} from "../../../model/TransactionRequest";
import {getKnexRead} from "../../../dbUtils";
import {
    InternalTransactionPlanStep, LightrailTransactionPlanStep, StripeTransactionPlanStep,
    TransactionPlanStep
} from "./TransactionPlan";
import {QueryBuilder} from "knex";
import {DbValue, Value} from "../../../model/Value";

export async function resolveTransactionParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, parties: TransactionParty[]): Promise<TransactionPlanStep[]> {
    const lightrailValueIds = parties.filter(p => p.rail === "lightrail" && p.valueId).map(p => (p as LightrailTransactionParty).valueId);
    const lightrailCodes = parties.filter(p => p.rail === "lightrail" && p.code).map(p => (p as LightrailTransactionParty).code);
    const lightrailcontactIds = parties.filter(p => p.rail === "lightrail" && p.contactId).map(p => (p as LightrailTransactionParty).contactId);

    const lightrailValues = await getLightrailValues(auth, currency, lightrailValueIds, lightrailCodes, lightrailcontactIds);
    const lightrailSteps = lightrailValues
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v.value,
            codeLastFour: v.codeLastFour,
            contactId: v.contactId,
            amount: 0
        }));

    const internalSteps = parties
        .filter(p => p.rail === "internal")
        .map((p: InternalTransactionParty): InternalTransactionPlanStep => ({
            rail: "internal",
            internalId: p.id,
            value: p.value,
            pretax: !!p.pretax,
            beforeLightrail: !!p.beforeLightrail,
            amount: 0
        }));

    const stripeSteps = parties
        .filter(p => p.rail === "stripe")
        .map((p: StripeTransactionParty): StripeTransactionPlanStep => ({
            rail: "stripe",
            token: p.token,
            maxAmount: p.maxAmount || null,
            priority: p.priority || 0,
            stripeSecretKey: null,
            amount: 0
        }));
    if (stripeSteps.length > 0) {
        // TODO fetch and fill in stripeSecretKey
        throw new cassava.RestError(500, "stripe isn't supported yet");
    }

    return [...lightrailSteps, ...internalSteps, ...stripeSteps];
}

async function getLightrailValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, valueIds: string[], codes: string[], contactIds: string[]): Promise<({value: Value, codeLastFour: string, contactId: string})[]> {
    if (!valueIds.length && !codes.length && !contactIds.length) {
        return [];
    }

    const knex = await getKnexRead();

    // This is untested but it's approximately right.
    let query: QueryBuilder;

    if (valueIds.length) {
        query = knex("Values")
            .select("*")
            .select(knex.raw("NULL as codeLastFour, NULL as contactId"))   // need NULL values here so it lines up for the union
            .where({
                userId: auth.giftbitUserId,
                currency,
                frozen: false,
                active: true,
                expired: false
            })
            .where(q => q.whereNull("uses").orWhere("uses", ">", 0))
            .whereIn("valueId", valueIds);
    }

    if (codes.length) {
        query = query ? query.unionAll(selectByCodes(auth, currency, codes)) : selectByCodes(auth, currency, codes)(knex("Values"));
    }

    if (contactIds.length) {
        query = query ? query.unionAll(selectBycontactIds(auth, currency, contactIds)) : selectBycontactIds(auth, currency, contactIds)(knex("Values"));
    }

    const values: (DbValue & {codeLastFour: string, contactId: string})[] = await query;
    return values.map(v => ({
        value: DbValue.toValue(v),
        codeLastFour: v.codeLastFour,
        contactId: v.contactId
    }));
}

function selectByCodes(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, codes: string[]): (query: QueryBuilder) => QueryBuilder {
    return query => query.select("*", "ValueAccess.codeLastFour as codeLastFour", "ValueAccess.contactId as contactId")
        .join("ValueAccess", {
            "Values.userId": "ValueAccess.userId",
            "Values.valueId": "ValueAccess.valueId"
        })
        .where({
            userId: auth.giftbitUserId,
            currency,
            frozen: false,
            active: true,
            expired: false
        })
        .where(q => q.whereNull("uses").orWhere("uses", ">", 0))
        .whereIn("ValueAccess.code", codes);
}

function selectBycontactIds(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, contactIds: string[]): (query: QueryBuilder) => QueryBuilder {
    return query => query.select("*", "ValueAccess.codeLastFour as codeLastFour", "ValueAccess.contactId as contactId")
        .join("ValueAccess", {
            "Values.userId": "ValueAccess.userId",
            "Values.valueId": "ValueAccess.valueId"
        })
        .where({
            userId: auth.giftbitUserId,
            currency,
            frozen: false,
            active: true,
            expired: false
        })
        .where(q => q.whereNull("uses").orWhere("uses", ">", 0))
        .whereIn("ValueAccess.contactId", contactIds);
}

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
import {DbValueStore} from "../../../dbmodel/DbValueStore";

export async function resolveTransactionParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, parties: TransactionParty[]): Promise<TransactionPlanStep[]> {
    const lightrailValueStoreIds = parties.filter(p => p.rail === "lightrail" && p.valueStoreId).map(p => (p as LightrailTransactionParty).valueStoreId);
    const lightrailCodes = parties.filter(p => p.rail === "lightrail" && p.code).map(p => (p as LightrailTransactionParty).code);
    const lightrailCustomerIds = parties.filter(p => p.rail === "lightrail" && p.customerId).map(p => (p as LightrailTransactionParty).customerId);

    const lightrailValueStores = await getLightrailValueStores(auth, currency, lightrailValueStoreIds, lightrailCodes, lightrailCustomerIds);
    const lightrailSteps = lightrailValueStores
        .map((valueStore): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            valueStore,
            amount: 0
        }));

    const internalSteps = parties
        .filter(p => p.rail === "internal")
        .map((p: InternalTransactionParty): InternalTransactionPlanStep => ({
            rail: "internal",
            internalId: p.id,
            value: p.value,
            pretax: !!p.pretax,
            appliedFirst: !!p.appliedFirst,
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

async function getLightrailValueStores(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, valueStoreIds: string[], codes: string[], customerIds: string[]): Promise<(DbValueStore & {codeLastFour: string, customerId: string})[]> {
    if (!valueStoreIds.length && !codes.length && !customerIds.length) {
        return [];
    }

    const knex = await getKnexRead();

    // This is untested but it's approximately right.
    let query: QueryBuilder;

    if (valueStoreIds.length) {
        query = knex("ValueStores")
            .select("ValueStores.*")
            .select(knex.raw("NULL as codeLastFour, NULL as customerId"))   // need NULL values here so it lines up for the union
            .where({
                userId: auth.giftbitUserId,
                currency,
                frozen: false,
                active: true,
                expired: false
            })
            .whereIn("valueStoreId", valueStoreIds);
    }

    if (codes) {
        query = query ? query.unionAll(selectByCodes(auth, currency, codes)) : selectByCodes(auth, currency, codes)(knex("ValueStores"));
    }

    if (customerIds.length) {
        query = query ? query.unionAll(selectByCustomerIds(auth, currency, customerIds)) : selectByCustomerIds(auth, currency, customerIds)(knex("ValueStores"));
    }

    return await query;
}

function selectByCodes(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, codes: string[]): (query: QueryBuilder) => QueryBuilder {
    return query => query.select("*", "ValueStoreAccess.codeLastFour as codeLastFour", "ValueStoreAccess.customerId as customerId")
        .join("ValueStoreAccess", {
            "ValueStores.userId": "ValueStoreAccess.userId",
            "ValueStores.valueStoreId": "ValueStoreAccess.valueStoreId"
        })
        .where({
            userId: auth.giftbitUserId,
            currency,
            frozen: false,
            active: true,
            expired: false
        })
        .whereIn("ValueStoreAccess.code", codes);
}

function selectByCustomerIds(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, customerIds: string[]): (query: QueryBuilder) => QueryBuilder {
    return query => query.select("*", "ValueStoreAccess.codeLastFour as codeLastFour", "ValueStoreAccess.customerId as customerId")
        .join("ValueStoreAccess", {
            "ValueStores.userId": "ValueStoreAccess.userId",
            "ValueStores.valueStoreId": "ValueStoreAccess.valueStoreId"
        })
        .where({
            userId: auth.giftbitUserId,
            currency,
            frozen: false,
            active: true,
            expired: false
        })
        .whereIn("ValueStoreAccess.customerId", customerIds);
}

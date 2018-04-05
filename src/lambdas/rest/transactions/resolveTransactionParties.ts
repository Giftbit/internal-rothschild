import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    InternalTransactionParty, LightrailTransactionParty, StripeTransactionParty,
    TransactionParty
} from "../../../model/TransactionRequest";
import {ValueStore} from "../../../model/ValueStore";
import {getKnex, getKnexRead} from "../../../dbUtils";
import {
    InternalTransactionPlanStep, LightrailTransactionPlanStep, StripeTransactionPlanStep,
    TransactionPlanStep
} from "./TransactionPlan";

export async function resolveTransactionParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, parties: TransactionParty[]): Promise<TransactionPlanStep[]> {
    const lightrailValueStoreIds = parties.filter(p => p.rail === "lightrail" && p.valueStoreId).map(p => (p as LightrailTransactionParty).valueStoreId);
    const lightrailCodes = parties.filter(p => p.rail === "lightrail" && p.code).map(p => (p as LightrailTransactionParty).code);
    const lightrailCustomerIds = parties.filter(p => p.rail === "lightrail" && p.customerId).map(p => (p as LightrailTransactionParty).customerId);

    let lightrailValueStores: ValueStore[] = [];
    if (lightrailValueStoreIds.length || lightrailCodes.length || lightrailCustomerIds.length) {
        const knex = await getKnexRead();
        lightrailValueStores = await knex("ValueStores")
            .where({
                userId: auth.giftbitUserId,
                frozen: false,
                active: true,
                expired: false
            })
            .andWhere(function () {
                // This is a fairly advanced subquery where I'm doing things conditionally.
                let query = this;
                if (lightrailValueStoreIds.length) {
                    query = query.orWhereIn("valueStoreId", lightrailValueStoreIds);
                }
                if (lightrailCodes.length) {
                    // TODO join on value store access
                    throw new cassava.RestError(500, "lightrail code isn't supported yet");
                }
                if (lightrailCustomerIds.length) {
                    // TODO join on value store access
                    throw new cassava.RestError(500, "lightrail customerId isn't supported yet");
                }
                return query;
            })
            .select();
    }
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

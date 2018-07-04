import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    InternalTransactionParty,
    LightrailTransactionParty,
    StripeTransactionParty,
    TransactionParty
} from "../../../model/TransactionRequest";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlanStep
} from "./TransactionPlan";
import {DbValue, Value} from "../../../model/Value";
import {getKnexRead} from "../../../utils/dbUtils/connection";

export async function resolveTransactionParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, parties: TransactionParty[], transactionId: string): Promise<TransactionPlanStep[]> {
    const lightrailValueIds = parties.filter(p => p.rail === "lightrail" && p.valueId).map(p => (p as LightrailTransactionParty).valueId);
    const lightrailCodes = parties.filter(p => p.rail === "lightrail" && p.code).map(p => (p as LightrailTransactionParty).code);
    const lightrailContactIds = parties.filter(p => p.rail === "lightrail" && p.contactId).map(p => (p as LightrailTransactionParty).contactId);

    const lightrailValues = await getLightrailValues(auth, currency, lightrailValueIds, lightrailCodes, lightrailContactIds);
    const lightrailSteps = lightrailValues
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v,
            amount: 0
        }));

    const internalSteps = parties
        .filter(p => p.rail === "internal")
        .map((p: InternalTransactionParty): InternalTransactionPlanStep => ({
            rail: "internal",
            internalId: p.id,
            balance: p.balance,
            pretax: !!p.pretax,
            beforeLightrail: !!p.beforeLightrail,
            amount: 0
        }));

    const stripeSteps = parties
        .filter(p => p.rail === "stripe")
        .map((p: StripeTransactionParty, index): StripeTransactionPlanStep => ({
            rail: "stripe",
            idempotentStepId: `${transactionId}-${index}`,
            source: p.source || null,
            customer: p.customer || null,
            maxAmount: p.maxAmount || null,
            amount: 0
        }));

    return [...lightrailSteps, ...internalSteps, ...stripeSteps];
}

async function getLightrailValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, valueIds: string[], codes: string[], contactIds: string[]): Promise<Value[]> {
    if (!valueIds.length && !codes.length && !contactIds.length) {
        return [];
    }

    const knex = await getKnexRead();
    const values: DbValue[] = await knex("Values")
        .where({
            userId: auth.giftbitUserId,
            currency,
            frozen: false,
            active: true,
            canceled: false
        })
        .where(q => q.whereNull("uses").orWhere("uses", ">", 0))
        .where(q => {
            if (valueIds.length) {
                q = q.whereIn("id", valueIds);
            }
            if (codes.length) {
                q = q.orWhereIn("code", codes);
            }
            if (contactIds.length) {
                q = q.orWhereIn("contactId", contactIds);
            }
            return q;
        });

    return values.map(DbValue.toValue);
}

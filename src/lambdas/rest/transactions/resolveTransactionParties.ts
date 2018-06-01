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
import {DbValue, Value} from "../../../model/Value";

export async function resolveTransactionParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, currency: string, parties: TransactionParty[]): Promise<TransactionPlanStep[]> {
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

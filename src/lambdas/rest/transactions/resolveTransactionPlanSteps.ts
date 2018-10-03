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
import {computeCodeLookupHash} from "../../../utils/codeCryptoUtils";
import {nowInDbPrecision} from "../../../utils/dbUtils";

/**
 * Options to resolving transaction parties.
 */
export interface ResolveTransactionPartiesOptions {
    parties: TransactionParty[];
    currency: string;
    transactionId: string;
    acceptNotTansactable: boolean;
    acceptZeroUses: boolean;
    acceptZeroBalance: boolean;
}

export async function resolveTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<TransactionPlanStep[]> {
    const lightrailValues = await getLightrailValues(auth, options);
    const lightrailSteps = lightrailValues
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v,
            amount: 0,
            uses: null,
            knownTransactable: !options.acceptNotTansactable
        }));

    const internalSteps = options.parties
        .filter(p => p.rail === "internal")
        .map((p: InternalTransactionParty): InternalTransactionPlanStep => ({
            rail: "internal",
            internalId: p.internalId,
            balance: p.balance,
            pretax: !!p.pretax,
            beforeLightrail: !!p.beforeLightrail,
            amount: 0
        }));

    const stripeSteps = options.parties
        .filter(p => p.rail === "stripe")
        .map((p: StripeTransactionParty, index): StripeTransactionPlanStep => ({
            rail: "stripe",
            idempotentStepId: `${options.transactionId}-${index}`,
            source: p.source || null,
            customer: p.customer || null,
            maxAmount: p.maxAmount || null,
            additionalStripeParams: p.additionalStripeParams || null,
            amount: 0
        }));

    return [...lightrailSteps, ...internalSteps, ...stripeSteps];
}

async function getLightrailValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<Value[]> {
    const valueIds = options.parties.filter(p => p.rail === "lightrail" && p.valueId)
        .map(p => (p as LightrailTransactionParty).valueId);

    const hashedCodes = options.parties.filter(p => p.rail === "lightrail" && p.code)
        .map(p => (p as LightrailTransactionParty).code)
        .map(code => computeCodeLookupHash(code, auth));

    const contactIds = options.parties.filter(p => p.rail === "lightrail" && p.contactId)
        .map(p => (p as LightrailTransactionParty).contactId);

    if (!valueIds.length && !hashedCodes.length && !contactIds.length) {
        return [];
    }

    const knex = await getKnexRead();
    const now = nowInDbPrecision();
    let query = knex("Values")
        .where({
            userId: auth.userId,
            currency: options.currency
        })
        .where(q => {
            if (valueIds.length) {
                q = q.whereIn("id", valueIds);
            }
            if (hashedCodes.length) {
                q = q.orWhereIn("codeHashed", hashedCodes);
            }
            if (contactIds.length) {
                q = q.orWhereIn("contactId", contactIds);
            }
            return q;
        });
    if (!options.acceptNotTansactable) {
        query = query
            .where({
                canceled: false,
                frozen: false,
                active: true
            })
            .where(q => q.whereNull("startDate").orWhere("startDate", ">", now))
            .where(q => q.whereNull("endDate").orWhere("endDate", "<", now));
    }
    if (!options.acceptZeroUses) {
        query = query.where(q => q.whereNull("usesRemaining").orWhere("usesRemaining", ">", 0));
    }
    if (!options.acceptZeroBalance) {
        query = query.where(q => q.whereNull("balance").orWhere("balance", ">", 0));
    }

    const values: DbValue[] = await query;
    return values.map(value => DbValue.toValue(value));
}

export function requireLightrailTransactionPlanStepTransactable(step: LightrailTransactionPlanStep): void {
    if (step.value.canceled) {
        throw new giftbitRoutes.GiftbitRestError(409, `Value '${step.value.id}' cannot be transacted against because it is canceled.`, "ValueCanceled");
    }
    if (step.value.frozen) {
        throw new giftbitRoutes.GiftbitRestError(409, `Value '${step.value.id}' cannot be transacted against because it is frozen.`, "ValueFrozen");
    }
    if (!step.value.active) {
        throw new giftbitRoutes.GiftbitRestError(409, `Value '${step.value.id}' cannot be transacted against because it is inactive.`, "ValueInactive");
    }

    const now = nowInDbPrecision();
    if (step.value.startDate && step.value.startDate > now) {
        throw new giftbitRoutes.GiftbitRestError(409, `Value '${step.value.id}' cannot be transacted against because it has not started.`, "ValueNotStarted");
    }
    if (step.value.endDate && step.value.endDate < now) {
        throw new giftbitRoutes.GiftbitRestError(409, `Value '${step.value.id}' cannot be transacted against because it expired.`, "ValueExpired");
    }

    step.knownTransactable = true;
}

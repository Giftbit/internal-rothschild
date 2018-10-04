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

    /**
     * The currency of the transaction.
     * NOTE: when we do currency conversion transactions this will have
     * to be refactored.
     */
    currency: string;

    /**
     * The ID that will be given to the transaction.
     */
    transactionId: string;

    /**
     * What to do about Lightrail Values that can not be transacted against
     * (because they are canceled, frozen, etc...).
     * - error: throw a 409 GiftbitRestError
     * - exclude: remove them from the results
     * - include: accept them in the results
     */
    nonTransactableHandling: "error" | "exclude" | "include";

    /**
     * Whether to accept Lightrail Values with 0 usesRemaining in the results.
     */
    includeZeroUsesRemaining: boolean;

    /**
     * Whether to accept Lightrail Values with 0 balance in the results.
     */
    includeZeroBalance: boolean;
}

export async function resolveTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<TransactionPlanStep[]> {
    const lightrailValues = await getLightrailValues(auth, options);
    const lightrailSteps = lightrailValues
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v,
            amount: 0,
            uses: null
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
            userId: auth.userId
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
    if (options.nonTransactableHandling === "exclude") {
        query = query
            .where({
                currency: options.currency,
                canceled: false,
                frozen: false,
                active: true
            })
            .where(q => q.whereNull("startDate").orWhere("startDate", "<", now))
            .where(q => q.whereNull("endDate").orWhere("endDate", ">", now));
    }
    if (!options.includeZeroUsesRemaining) {
        query = query.where(q => q.whereNull("usesRemaining").orWhere("usesRemaining", ">", 0));
    }
    if (!options.includeZeroBalance) {
        query = query.where(q => q.whereNull("balance").orWhere("balance", ">", 0));
    }

    const dbValues: DbValue[] = await query;
    const values = dbValues.map(value => DbValue.toValue(value));

    if (options.nonTransactableHandling === "error") {
        // Throw an error if we have any Values that *would* have been filtered out
        // on `options.nonTransactableHandling === "filter"`.  This is inherently a
        // duplication of logic (which is often a bad idea) but filtering on the DB
        // when acceptable is a *huge* performance gain.
        for (const value of values) {
            if (value.currency !== options.currency) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' is in currency '${value.currency}' which is not the transaction's currency '${options.currency}'.`, "WrongCurrency");
            }

            if (value.canceled) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it is canceled.`, "ValueCanceled");
            }
            if (value.frozen) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it is frozen.`, "ValueFrozen");
            }
            if (!value.active) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it is inactive.`, "ValueInactive");
            }

            const now = nowInDbPrecision();
            if (value.startDate && value.startDate > now) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it has not started.`, "ValueNotStarted");
            }
            if (value.endDate && value.endDate < now) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it expired.`, "ValueEnded");
            }
        }
    }

    return values;
}

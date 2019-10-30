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
    TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";
import {DbValue, Value} from "../../../model/Value";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import {computeCodeLookupHash} from "../../../utils/codeCryptoUtils";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import * as knex from "knex";
import {getContact} from "../contacts";
import {getStripeMinCharge} from "../../../utils/stripeUtils/getStripeMinCharge";

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
    const fetchedValues = await getLightrailValues(auth, options);
    return getTransactionPlanStepsFromSources(
        options.transactionId,
        options.currency,
        fetchedValues,
        options.parties.filter(party => party.rail !== "lightrail") as (StripeTransactionParty | InternalTransactionParty)[]
    );
}

/**
 * Translates Values loaded from the database and non Lightrail sources into TransactionPlanSteps.
 * Used when the Values have already been loaded from the DB.
 */
export function getTransactionPlanStepsFromSources(transactionId: string, currency: string, lightrailSources: Value[], nonLightrailSources: (StripeTransactionParty | InternalTransactionParty)[]): TransactionPlanStep[] {
    const lightrailSteps = lightrailSources
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v,
            amount: 0,
            uses: null,
            action: "update"
        }));

    const internalSteps = nonLightrailSources
        .filter(p => p.rail === "internal")
        .map((p: InternalTransactionParty): InternalTransactionPlanStep => ({
            rail: "internal",
            internalId: p.internalId,
            balance: p.balance,
            pretax: !!p.pretax,
            beforeLightrail: !!p.beforeLightrail,
            amount: 0
        }));


    const stripeSteps = nonLightrailSources
        .filter(p => p.rail === "stripe")
        .map((p: StripeTransactionParty, index): StripeTransactionPlanStep => ({
            rail: "stripe",
            type: "charge",
            stepIdempotencyKey: `${transactionId}-${index}`,
            source: p.source || null,
            customer: p.customer || null,
            maxAmount: p.maxAmount || null,
            minAmount: p.minAmount != null ? p.minAmount : getStripeMinCharge(currency),
            forgiveSubMinAmount: !!p.forgiveSubMinAmount,
            additionalStripeParams: p.additionalStripeParams || null,
            amount: 0
        }));

    return [...lightrailSteps, ...internalSteps, ...stripeSteps];
}

export async function getLightrailValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<Value[]> {
    const valueIds = options.parties.filter(p => p.rail === "lightrail" && p.valueId)
        .map(p => (p as LightrailTransactionParty).valueId);

    const hashedCodesPromises = options.parties.filter(p => p.rail === "lightrail" && p.code)
        .map(p => (p as LightrailTransactionParty).code)
        .map(code => computeCodeLookupHash(code, auth));
    const hashedCodes = await Promise.all(hashedCodesPromises);

    const contactIds = options.parties.filter(p => p.rail === "lightrail" && p.contactId)
        .map(p => (p as LightrailTransactionParty).contactId);

    if (!valueIds.length && !hashedCodes.length && !contactIds.length) {
        return [];
    }

    const knex = await getKnexRead();
    const now = nowInDbPrecision();

    /**
     * Build query dynamically depending on what types of Value identifiers are used.
     * The callback function builds the core part of the query properly ('TT') before adding the extra filters below
     * (nonTransactableHandling, includeZeroUsesRemaining, includeZeroBalance).
     * We have a composite index for userId + each of value ID/code/contactId so UNION is more efficient than OR WHERE.
     * Note, contactId is also returned in an extra column 'contactIdForResult' to make the union between Values
     *  and ContactValues work.
     */
    let query = knex.select("*").from(queryBuilder =>  {
        if (contactIds.length) {
            queryBuilder.union(knex.raw("SELECT V.*, CV.contactId AS contactIdForResult FROM `Values` V JOIN `ContactValues` CV ON V.`userId` = CV.`userId` AND V.`id` = CV.`valueId` WHERE CV.`userId` = ? AND CV.contactId IN (?)", [auth.userId, contactIds]));
            queryBuilder.union(knex.select("*", "contactId as contactIdForResult").from("Values")
                .where("userId", "=", auth.userId).andWhere("contactId", "in", contactIds));
        }

        if (hashedCodes.length) {
            queryBuilder.union(knex.select("*", "contactId as contactIdForResult").from("Values")
                .where("userId", "=", auth.userId).andWhere("codeHashed", "in", hashedCodes));
        }

        if (valueIds.length) {
            queryBuilder.union(knex.select("*", "contactId as contactIdForResult").from("Values")
                .where("userId", "=", auth.userId).andWhere("id", "in", valueIds));
        }

        queryBuilder.as("TT");
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
    const dbValuesWithContactId: DbValue[] = dbValues.map((v: any) => ({
        ...v,
        contactId: v.contactId || v.contactIdForResult // Persist the contactId to the value record if it was looked up via the ContactValues table
    }));
    const values = await Promise.all(dbValuesWithContactId.map(value => DbValue.toValue(value)));

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

export function filterForUsedAttaches(attachTransactionPlans: TransactionPlan[], transactionPlan: TransactionPlan) {
    const attachTransactionsToPersist: TransactionPlan[] = [];
    for (const attach of attachTransactionPlans) {
        const newAttachedValue: LightrailTransactionPlanStep = attach.steps.find(s => (s as LightrailTransactionPlanStep).action === "insert") as LightrailTransactionPlanStep;
        if (transactionPlan.steps.find(s => s.rail === "lightrail" && s.value.id === newAttachedValue.value.id)) {
            // new attached value was used
            attachTransactionsToPersist.push(attach);
        }
    }
    return attachTransactionsToPersist;
}

export async function getContactIdFromSources(auth: giftbitRoutes.jwtauth.AuthorizationBadge, parties: TransactionParty[]): Promise<string> {
    const contactPaymentSource = parties.find(p => p.rail === "lightrail" && p.contactId != null) as LightrailTransactionParty;
    const contactId = contactPaymentSource ? contactPaymentSource.contactId : null;

    if (contactId) {
        const contact = await getContact(auth, contactId);
        return contact.id;
    } else {
        return null;
    }
}

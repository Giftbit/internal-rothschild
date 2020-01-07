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
import {getContact} from "../contacts";
import {getStripeMinCharge} from "../../../utils/stripeUtils/getStripeMinCharge";

/**
 * Options to resolving transaction parties.
 */
export interface ResolveTransactionPartiesOptions {
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
     * (because they are canceled, frozen, inactive, unstarted, ended, wrong currency).
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

export async function resolveTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, parties: TransactionParty[], options: ResolveTransactionPartiesOptions): Promise<TransactionPlanStep[]> {
    const fetchedValues = (await getLightrailSourcesForTransactionPlanSteps(auth, parties, options)).values;
    return getTransactionPlanStepsFromSources(
        fetchedValues,
        parties.filter(party => party.rail !== "lightrail") as (StripeTransactionParty | InternalTransactionParty)[],
        options
    );
}

/**
 * Translates Values loaded from the database and non Lightrail sources into TransactionPlanSteps.
 * Used when the Values have already been loaded from the DB.
 */
export function getTransactionPlanStepsFromSources(lightrailSources: Value[], nonLightrailSources: (StripeTransactionParty | InternalTransactionParty)[], options: ResolveTransactionPartiesOptions): TransactionPlanStep[] {
    const lightrailSteps = lightrailSources
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v,
            amount: 0,
            uses: null,
            action: "update",
            allowCanceled: options.nonTransactableHandling === "include",
            allowFrozen: options.nonTransactableHandling === "include"
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
            stepIdempotencyKey: `${options.transactionId}-${index}`,
            source: p.source || null,
            customer: p.customer || null,
            maxAmount: p.maxAmount || null,
            minAmount: p.minAmount != null ? p.minAmount : getStripeMinCharge(options.currency),
            forgiveSubMinAmount: !!p.forgiveSubMinAmount,
            additionalStripeParams: p.additionalStripeParams || null,
            amount: 0
        }));

    return [...lightrailSteps, ...internalSteps, ...stripeSteps];
}

export async function getLightrailSourcesForTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, parties: TransactionParty[], options: ResolveTransactionPartiesOptions): Promise<{ values: Value[], contactIds: string[] }> {
    let values = await getAllPossibleValues(auth, parties);

    let contactIdsForResult = [...new Set([...values.map(v => v.contactId), ...parties.filter(p => p.rail === "lightrail" && p.contactId).map(p => (p as LightrailTransactionParty).contactId)])];

    values = handleNonTransactableValues(values, options, true).values;

    return {values, contactIds: contactIdsForResult};
}

function handleNonTransactableValues(values: Value[], options: ResolveTransactionPartiesOptions, returnNonTransactableContactIds: boolean): { values: Value[], contactIds: string[] } {
    const now = nowInDbPrecision();

    let result = {
        values: [...values],
        contactIds: values.map(v => v.id)
    };

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

            if (value.startDate && value.startDate > now) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it has not started.`, "ValueNotStarted");
            }
            if (value.endDate && value.endDate < now) {
                throw new giftbitRoutes.GiftbitRestError(409, `Value '${value.id}' cannot be transacted against because it expired.`, "ValueEnded");
            }
        }
    } else if (options.nonTransactableHandling === "exclude") {
        result.values = values.filter(v =>
            (v.currency === options.currency) &&
            !v.canceled &&
            !v.frozen &&
            v.active &&
            (!v.startDate || v.startDate <= now) &&
            (!v.endDate || v.endDate >= now)
        )
    } else if (options.nonTransactableHandling === "include") {
        // all values should be returned
    }

    if (!options.includeZeroBalance) {
        result.values = result.values.filter(v => (v.balance === null) || (v.balance === 0 && options.includeZeroBalance) || (v.balance > 0))
    }

    if (!options.includeZeroUsesRemaining) {
        result.values = result.values.filter(v => (v.usesRemaining === null) || (v.usesRemaining === 0 && options.includeZeroUsesRemaining) || (v.usesRemaining > 0))
    }

    if (!returnNonTransactableContactIds) {
        result.contactIds = result.values.map(v => v.contactId);
    }

    return result;
}

export async function getAllPossibleValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, parties: TransactionParty[]): Promise<Value[]> {
    const valueIds = parties.filter(p => p.rail === "lightrail" && p.valueId)
        .map(p => (p as LightrailTransactionParty).valueId);

    const hashedCodesPromises = parties.filter(p => p.rail === "lightrail" && p.code)
        .map(p => (p as LightrailTransactionParty).code)
        .map(code => computeCodeLookupHash(code, auth));
    const hashedCodes = await Promise.all(hashedCodesPromises);

    const contactIds = parties.filter(p => p.rail === "lightrail" && p.contactId)
        .map(p => (p as LightrailTransactionParty).contactId);

    if (!valueIds.length && !hashedCodes.length && !contactIds.length) {
        return [];
    }

    const knex = await getKnexRead();

    /**
     * Note on query structure: The Values table has a composite index for each of userId+ID, userId+code, userId+contactId
     *  so it's more efficient to use those in a set of UNION subqueries to build up the FROM clause, than it was to use
     *  'OR WHERE code = ? OR WHERE contactId = ?' ...etc, which resulted in a full table scan.
     */
    let query = knex.select("*").from(queryBuilder => {
        if (contactIds.length) {
            queryBuilder.union(
                knex.select("V.*", "CV.contactId AS contactIdForResult") // contactId returned in an extra column so it can be tracked for shared generics looked up by contactId
                    .from("Values AS V")
                    .join("ContactValues AS CV", {"V.userId": "CV.userId", "V.id": "CV.valueId"})
                    .where({"CV.userId": auth.userId})
                    .andWhere("CV.contactId", "in", contactIds)
            );

            queryBuilder.union(
                knex.select("*", "contactId as contactIdForResult")
                    .from("Values")
                    .where({"userId": auth.userId})
                    .andWhere("contactId", "in", contactIds)
            );
        }

        if (hashedCodes.length) {
            queryBuilder.union(
                knex.select("*", "contactId as contactIdForResult")
                    .from("Values")
                    .where({"userId": auth.userId})
                    .andWhere("codeHashed", "in", hashedCodes)
            );
        }

        if (valueIds.length) {
            queryBuilder.union(
                knex.select("*", "contactId as contactIdForResult")
                    .from("Values")
                    .where({"userId": auth.userId})
                    .andWhere("id", "in", valueIds)
            );
        }

        queryBuilder.as("TT");
    });

    const dbValues: (DbValue & { contactIdForResult: string | null })[] = await query;
    const dedupedDbValues = consolidateValueQueryResults(dbValues);
    return await Promise.all(dedupedDbValues.map(value => DbValue.toValue(value)));
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

function consolidateValueQueryResults(values: (DbValue & { contactIdForResult: string | null })[]): DbValue[] {
    return values
        .map((v) => ({
            ...v,
            contactId: v.contactId || v.contactIdForResult // Persist the contactId to the value record if it was looked up via the ContactValues table
        }))
        .filter((v, index, dbValues) => {
            if (v.contactId) {
                const firstValue = dbValues.find(firstValue => firstValue.id === v.id && firstValue.contactId === v.contactId);
                return dbValues.indexOf(firstValue) === index; // unique attached values can only be used once per transaction but might have been included twice in the payment sources (eg by code and also by contactId)
            } else {
                return !dbValues.find(otherValue => otherValue.id === v.id && otherValue.contactId); // generic codes can be used by two different contacts in the same transaction, but not by a contact and also anonymously: skip anonymous usage if this value is also attached
            }
        });
}

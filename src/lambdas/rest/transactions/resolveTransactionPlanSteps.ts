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
import {GenericCodePerContact} from "../genericCodePerContact";
import {getContact} from "../contacts";
import log = require("loglevel");

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

    /**
     * Whether generic codes with per contact properties should be auto attached.
     */
    autoAttach?: boolean;
}

export interface ResolvedTransactionPlanSteps {
    attachTransactions: TransactionPlan[];
    transactionSteps: TransactionPlanStep[];
}

export async function resolveTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<ResolvedTransactionPlanSteps> {
    const fetchedValues = await getLightrailValues(auth, options);
    let valuesForTx: Value[];

    const resolvedTransactionSteps: ResolvedTransactionPlanSteps = {
        attachTransactions: [],
        transactionSteps: []
    };
    if (options.autoAttach) {
        const valuesThatMustBeAttached: Value[] = fetchedValues.filter(v => Value.isGenericCodeWithPropertiesPerContact(v));
        // Can't attach all generic codes because existing generic codes can't be distinguished if the user is calling
        // attach with attachGenericAsNewValue: true.
        valuesForTx = fetchedValues.filter(v => valuesThatMustBeAttached.indexOf(v) === -1);

        if (valuesThatMustBeAttached.length > 0) {
            const contactId = await getContactIdFromSources(auth, options);
            if (!contactId) {
                throw new giftbitRoutes.GiftbitRestError(409, `Values cannot be transacted against because they must be attached to a Contact first. Alternatively, a contactId must be included a source in the checkout request.`, "ValueMustBeAttached");
            }

            for (const genericValue of valuesThatMustBeAttached) {
                if (valuesForTx.find(v => v.attachedFromGenericValueId === genericValue.id)) {
                    log.debug(`Skipping attaching generic value ${genericValue.id} since it's already been attached.`);
                } else {
                    const transactionPlan = GenericCodePerContact.getTransactionPlan(auth, contactId, genericValue);
                    resolvedTransactionSteps.attachTransactions.push(transactionPlan);
                    valuesForTx.push((transactionPlan.steps.find(s => (s as LightrailTransactionPlanStep).action === "INSERT_VALUE") as LightrailTransactionPlanStep).value);
                }
            }
        }
    } else {
        valuesForTx = fetchedValues;
    }

    const lightrailSteps = valuesForTx
        .map((v): LightrailTransactionPlanStep => ({
            rail: "lightrail",
            value: v,
            amount: 0,
            uses: null,
            action: "UPDATE_VALUE"
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
            type: "charge",
            idempotentStepId: `${options.transactionId}-${index}`,
            source: p.source || null,
            customer: p.customer || null,
            maxAmount: p.maxAmount || null,
            additionalStripeParams: p.additionalStripeParams || null,
            amount: 0
        }));

    resolvedTransactionSteps.transactionSteps.push(...lightrailSteps, ...internalSteps, ...stripeSteps);
    return resolvedTransactionSteps;
}

async function getLightrailValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<Value[]> {
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
    let query: knex.QueryBuilder = knex("Values")
        .select("Values.*")
        .where("Values.userId", "=", auth.userId);
    if (contactIds.length) {
        query = query.leftJoin(knex.raw("(SELECT * FROM ContactValues WHERE userId = ? AND contactId in (?)) as ContactValuesTemp", [auth.userId, contactIds]), {
            "Values.id": "ContactValuesTemp.valueId",
            "Values.userId": "ContactValuesTemp.userId"
        }); // The temporary table only joins to ContactValues that have a contactId in contactIds. If a generic code is transacted against directly via code/valueId, a ContactValue that it is attached to is not joined to.
        query = query.groupBy("Values.id"); // Without groupBy, will return duplicate generic code if two contactId's are supplied as sources and both contact's have attached the generic code.
        query = query.select(knex.raw("IFNULL(ContactValuesTemp.contactId, Values.contactId) as contactId")); // If step was looked up via ContactId then need to sure the contactId persists to the Step for tracking purposes.
    }
    query = query.where(q => {
        if (valueIds.length) {
            q = q.whereIn("Values.id", valueIds);
        }
        if (hashedCodes.length) {
            q = q.orWhereIn("codeHashed", hashedCodes);
        }
        if (contactIds.length) {
            q = q.orWhereIn("Values.contactId", contactIds)
                .orWhereIn("ContactValuesTemp.contactId", contactIds);
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
    const values = await Promise.all(dbValues.map(value => DbValue.toValue(value)));

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

export function filterForUsedAttaches(resolvedSteps, transactionPlan: TransactionPlan) {
    const attachTransactionsToPersist: TransactionPlan[] = [];
    for (const attachTx of resolvedSteps.attachTransactions) {
        const newAttachedValue: LightrailTransactionPlanStep = attachTx.steps.find(s => (s as LightrailTransactionPlanStep).action === "INSERT_VALUE") as LightrailTransactionPlanStep;
        if (transactionPlan.steps.find(s => s.rail === "lightrail" && s.value.id === newAttachedValue.value.id)) {
            // new attached value was used
            attachTransactionsToPersist.push(attachTx);
        }
    }
    return attachTransactionsToPersist;
}

async function getContactIdFromSources(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ResolveTransactionPartiesOptions): Promise<string> {
    const contactPaymentSource = options.parties.find(p => p.rail === "lightrail" && p.contactId != null) as LightrailTransactionParty;
    const contactId = contactPaymentSource ? contactPaymentSource.contactId : null;

    if (contactId) {
        const contact = await getContact(auth, contactId);
        return contact.id;
    } else {
        return null;
    }
}
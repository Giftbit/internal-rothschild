import {Value} from "../../model/Value";
import {nowInDbPrecision} from "../../utils/dbUtils/index";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {
    LightrailInsertTransactionPlanStep,
    LightrailTransactionPlanStep,
    LightrailUpdateTransactionPlanStep,
    TransactionPlan
} from "./transactions/TransactionPlan";
import {executeTransactionPlanner} from "./transactions/executeTransactionPlans";
import {Transaction} from "../../model/Transaction";
import * as cassava from "cassava";
import {initializeValue} from "./values/createValue";
import {getIdForAttachingGenericValue} from "./contactValues";
import {MetricsLogger, ValueAttachmentTypes} from "../../utils/metricsLogger";

export async function attachGenericCode(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): Promise<Value> {
    let transaction: Transaction;
    let transactionPlan: TransactionPlan;
    try {
        transaction = await executeTransactionPlanner(auth, {
            allowRemainder: false,
            simulate: false
        }, async () => transactionPlan = await getAttachTransactionPlanForGenericCode(auth, contactId, genericValue));
    } catch (err) {
        if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "TransactionExists") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value '${genericValue.id}' has already been attached to the Contact '${contactId}'.`, "ValueAlreadyExists");
        } else {
            throw err;
        }
    }
    return (transactionPlan.steps.find((step: LightrailTransactionPlanStep) => step.action === "insert") as LightrailInsertTransactionPlanStep).value;
}

export async function getAttachTransactionPlanForGenericCode(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericCode: Value): Promise<TransactionPlan> {
    if (Value.isGenericCodeWithPropertiesPerContact(genericCode)) {
        return getAttachTransactionPlanForGenericCodeWithPerContactOptions(auth, contactId, genericCode);
    } else {
        return getAttachTransactionPlanForGenericCodeWithoutPerContactOptions(auth, contactId, genericCode);
    }
}

export async function getAttachTransactionPlanForGenericCodeWithoutPerContactOptions(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericCode: Value): Promise<TransactionPlan> {
    if (Value.isGenericCodeWithPropertiesPerContact(genericCode)) {
        throw new Error(`Invalid value passed in. ${genericCode.id}`);
    }
    MetricsLogger.valueAttachment(ValueAttachmentTypes.Generic, auth);

    const now = nowInDbPrecision();
    const newAttachedValueId = await getIdForAttachingGenericValue(auth, contactId, genericCode);
    const initialBalance = genericCode.balance;
    const initialUsesRemaining = genericCode.usesRemaining != null ? 1 : null; // if generic code has usesRemaining set, assume the attached values should get 1 usesRemaining.

    const newValue = initializeValue(auth, {
        ...genericCode,
        id: newAttachedValueId,
        code: null,
        isGenericCode: false,
        contactId: contactId,
        balance: initialBalance,
        usesRemaining: initialUsesRemaining,
        genericCodeOptions: undefined,
        metadata: {
            ...genericCode.metadata,
            attachedFromGenericValue: {
                code: genericCode.code
            }
        },
        attachedFromValueId: genericCode.id,
        createdDate: now,
        updatedDate: now,
        updatedContactIdDate: now,
        createdBy: auth.teamMemberId,
    });

    const updateStep: LightrailUpdateTransactionPlanStep = {
        rail: "lightrail",
        action: "update",
        value: genericCode,
        amount: genericCode.balance !== null ? 0 : null,
        uses: initialUsesRemaining != null ? -initialUsesRemaining : null,
        allowCanceled: false,
        allowFrozen: false
    };
    const insertStep: LightrailInsertTransactionPlanStep = {
        rail: "lightrail",
        action: "insert",
        value: newValue
    };

    return {
        id: newAttachedValueId,
        transactionType: "attach",
        currency: genericCode.currency,
        steps: [updateStep, insertStep],
        totals: null,
        lineItems: null,
        paymentSources: null,
        createdDate: now,
        metadata: null,
        tax: null
    };
}

export async function getAttachTransactionPlanForGenericCodeWithPerContactOptions(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): Promise<TransactionPlan> {
    if (!Value.isGenericCodeWithPropertiesPerContact(genericValue)) {
        throw new Error(`Invalid value passed in. ${genericValue.id}`);
    }
    MetricsLogger.valueAttachment(ValueAttachmentTypes.GenericPerContactProps, auth);

    const now = nowInDbPrecision();
    const newAttachedValueId = await getIdForAttachingGenericValue(auth, contactId, genericValue);
    const amount = genericValue.genericCodeOptions.perContact.balance;
    const uses = genericValue.genericCodeOptions.perContact.usesRemaining;

    const newValue = initializeValue(auth, {
        ...genericValue,
        id: newAttachedValueId,
        code: null,
        isGenericCode: false,
        contactId: contactId,
        balance: amount != null ? amount : null, // balance is initiated rather than being adjusted during inserting the step. this makes auto-attach during checkout work
        usesRemaining: uses != null ? uses : null, // likewise
        genericCodeOptions: undefined,
        metadata: {
            ...genericValue.metadata,
            attachedFromGenericValue: {
                code: genericValue.code
            }
        },
        attachedFromValueId: genericValue.id,
        createdDate: now,
        updatedDate: now,
        updatedContactIdDate: now,
        createdBy: auth.teamMemberId,
    });

    const updateStep: LightrailUpdateTransactionPlanStep = {
        rail: "lightrail",
        action: "update",
        value: genericValue,
        amount: genericValue.balance !== null ? -amount : null, // generic code can have balance: null but perContact balance set.
        uses: genericValue.usesRemaining !== null ? -uses : null, // likewise
        allowCanceled: false,
        allowFrozen: false
    };
    const insertStep: LightrailInsertTransactionPlanStep = {
        rail: "lightrail",
        action: "insert",
        value: newValue
    };

    return {
        id: newAttachedValueId,
        transactionType: "attach",
        currency: genericValue.currency,
        steps: [updateStep, insertStep],
        totals: null,
        lineItems: null,
        paymentSources: null,
        createdDate: now,
        metadata: null,
        tax: null
    };
}

/**
 * This function encodes to the RFC 4648 Spec where '+' is encoded as '-' and '/' is encoded as '_'. The padding character '=' is removed.
 */
export function generateUrlSafeHashFromValueIdContactId(genericValueId: string, contactId: string) {
    return crypto.createHash("sha1").update(genericValueId + "/" + contactId).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

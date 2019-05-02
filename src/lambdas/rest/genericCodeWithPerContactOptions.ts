import {Value} from "../../model/Value";
import {nowInDbPrecision} from "../../utils/dbUtils/index";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, TransactionPlan} from "./transactions/TransactionPlan";
import {executeTransactionPlanner} from "./transactions/executeTransactionPlans";
import {getValue} from "./values/values";
import {LightrailTransactionStep, Transaction} from "../../model/Transaction";
import * as cassava from "cassava";
import {initializeValue} from "./values/createValue";


export async function attachGenericCodeWithPerContactOptions(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): Promise<Value> {

    // todo - double check the type of Value
    let transaction: Transaction;
    let transactionPlan: TransactionPlan;
    try {
        transaction = await executeTransactionPlanner(auth, {
            allowRemainder: false,
            simulate: false
        }, async () => transactionPlan = getAttachTransactionPlanForGenericCodeWithPerContactOptions(auth, contactId, genericValue));
    } catch (err) {
        if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "TransactionExists") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value '${genericValue.id}' has already been attached to the Contact '${contactId}'.`, "ValueAlreadyAttached");
        } else {
            throw err;
        }
    }

    const newAttachedValueId = (transaction.steps.find(step => (step as LightrailTransactionStep).valueId !== genericValue.id) as LightrailTransactionStep).valueId;
    if (!newAttachedValueId) {
        throw new Error("This cannot happen. Something must have gone seriously wrong.");
    }

    // todo pull value out of transactionPlan.
    return await getValue(auth, newAttachedValueId);
}

export function getAttachTransactionPlanForGenericCodeWithPerContactOptions(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): TransactionPlan {
    if (!Value.isGenericCodeWithPropertiesPerContact(genericValue)) {
        throw new Error(`Invalid value passed in. ${genericValue.id}`)
    }

    const now = nowInDbPrecision();
    const newAttachedValueId = generateIdForNewAttachedValue(genericValue.id, contactId);
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
        genericCodeOptions: null,
        metadata: {
            ...genericValue.metadata,
            attachedFromGenericValue: {
                code: genericValue.code
            }
        },
        attachedFromGenericValueId: genericValue.id,
        createdDate: now,
        updatedDate: now,
        updatedContactIdDate: now,
        createdBy: auth.teamMemberId,
    });

    return {
        id: newAttachedValueId,
        transactionType: "attach",
        currency: genericValue.currency,
        steps: [
            {
                // generic code
                rail: "lightrail",
                action: "update",
                value: genericValue,
                amount: genericValue.balance !== null ? -amount : null, // generic code can have balance: null but perContact balance set.
                uses: genericValue.usesRemaining !== null ? -uses : null // likewise
            } as LightrailTransactionPlanStep,
            {
                rail: "lightrail",
                action: "insert",
                value: newValue,
                amount: amount,
                uses: uses,
            } as LightrailTransactionPlanStep
        ],
        totals: null,
        lineItems: null,
        paymentSources: null,
        createdDate: now,
        metadata: null,
        tax: null
    };

}

export function generateIdForNewAttachedValue(genericValueId: string, contactId: string) {
    return crypto.createHash("sha1").update(genericValueId + "/" + contactId).digest("base64").replace(/\//g, "-");
}
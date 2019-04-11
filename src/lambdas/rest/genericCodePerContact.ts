import {Value} from "../../model/Value";
import {nowInDbPrecision} from "../../utils/dbUtils/index";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, TransactionPlan} from "./transactions/TransactionPlan";
import {executeTransactionPlanner} from "./transactions/executeTransactionPlans";
import {getValue} from "./values";
import {LightrailTransactionStep, Transaction} from "../../model/Transaction";

export namespace GenericCodePerContact {
    export async function attach(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): Promise<Value> {

        const planner = async (): Promise<TransactionPlan> => {
            return getTransactionPlan(auth, contactId, genericValue);
        };

        const transaction: Transaction = await executeTransactionPlanner(auth, {
            allowRemainder: false,
            simulate: false
        }, planner);

        const newAttachedValueId = (transaction.steps.find(step => (step as LightrailTransactionStep).valueId !== genericValue.id) as LightrailTransactionStep).valueId;
        if (!newAttachedValueId) {
            throw new Error("This cannot happen. Something must have gone seriously wrong.")
        }

        return await getValue(auth, newAttachedValueId);
    }

    export function getTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, genericValue: Value): TransactionPlan {
        const now = nowInDbPrecision();
        const newAttachedValueId = generateValueId(genericValue.id, contactId);
        const amount = genericValue.genericCodeProperties.valuePropertiesPerContact.balance;
        const uses = genericValue.genericCodeProperties.valuePropertiesPerContact.usesRemaining;

        return {
            id: newAttachedValueId,
            transactionType: "attach",
            currency: genericValue.currency,
            steps: [
                {
                    // generic code
                    rail: "lightrail",
                    value: genericValue,
                    amount: genericValue.balance !== null ? -amount : null,
                    uses: genericValue.usesRemaining !== null ? -uses : null
                } as LightrailTransactionPlanStep,
                {
                    rail: "lightrail",
                    createValue: true,
                    value: {
                        ...genericValue,
                        id: newAttachedValueId,
                        code: null,
                        isGenericCode: false,
                        contactId: contactId,
                        balance: amount != null ? amount : null,
                        usesRemaining: uses != null ? uses : null,
                        genericCodeProperties: null,
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
                    },
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

    export function generateValueId(genericValueId: string, contactId: string) {
        return crypto.createHash("sha1").update(genericValueId + "/" + contactId).digest("base64").replace(/\//g, "-")
    }
}
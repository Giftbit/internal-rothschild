import * as stripe from "stripe";
import {
    InternalDbTransactionStep,
    InternalTransactionStep,
    LightrailDbTransactionStep,
    LightrailTransactionStep,
    StripeDbTransactionStep,
    StripeTransactionStep,
    Transaction,
    TransactionStep,
    TransactionTotals,
    TransactionType
} from "../../../model/Transaction";
import {formatCodeForLastFourDisplay, Value} from "../../../model/Value";
import {LineItemResponse} from "../../../model/LineItem";
import {
    AdditionalStripeChargeParams,
    LightrailTransactionParty,
    TransactionParty
} from "../../../model/TransactionRequest";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {TaxRequestProperties} from "../../../model/TaxProperties";

export interface TransactionPlan {
    id: string;
    transactionType: TransactionType;
    currency: string;
    totals: TransactionTotals;
    lineItems: LineItemResponse[] | null;
    paymentSources: TransactionParty[] | null;
    steps: TransactionPlanStep[];
    tax: TaxRequestProperties;
    pendingVoidDate?: Date;
    createdDate: Date;
    metadata: object | null;
    rootTransactionId?: string;
    previousTransactionId?: string;
}

export type TransactionPlanStep =
    LightrailTransactionPlanStep
    | StripeTransactionPlanStep
    | InternalTransactionPlanStep;

export interface LightrailTransactionPlanStep {
    rail: "lightrail";
    value: Value;
    amount: number;
    uses: number | null;
}

export interface StripeChargeTransactionPlanStep {
    rail: "stripe";
    type: "charge";
    idempotentStepId: string;
    source?: string;
    customer?: string;
    maxAmount: number | null;
    amount: number;
    additionalStripeParams: AdditionalStripeChargeParams | null;

    /**
     * Result of creating the charge in Stripe is only set if the plan is executed.
     */
    chargeResult?: stripe.charges.ICharge;
}

export interface StripeRefundTransactionPlanStep {
    rail: "stripe";
    type: "refund";
    idempotentStepId: string;

    /**
     * The ID of the charge to refund.
     */
    chargeId: string;

    amount: number;

    /**
     * Result of creating the refund.  Only set if the plan is executed.
     */
    refundResult?: stripe.refunds.IRefund;
    reason: string;
}

export interface StripeCaptureTransactionPlanStep {
    rail: "stripe";
    type: "capture";
    idempotentStepId: string;

    /**
     * The ID of the charge to capture.
     */
    chargeId: string;

    /**
     * The amount of the original pending charge.
     */
    pendingAmount: number;

    /**
     * The *adjustment* on how much was captured.  0 is capturing the full amount.
     * A number > 0 reduces the amount captured from the original charge.
     * Can't be < 0 because you can't capture more than the original charge.
     */
    amount: number;

    /**
     * Result of capturing the charge in Stripe is only set if the plan is executed.
     */
    captureResult?: stripe.charges.ICharge;
}

export type StripeTransactionPlanStep =
    StripeChargeTransactionPlanStep
    | StripeRefundTransactionPlanStep
    | StripeCaptureTransactionPlanStep;

export interface InternalTransactionPlanStep {
    rail: "internal";
    internalId: string;
    balance: number;
    pretax: boolean;
    beforeLightrail: boolean;
    amount: number;
}

export namespace LightrailTransactionPlanStep {
    export function toLightrailDbTransactionStep(step: LightrailTransactionPlanStep, plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge, stepIndex: number): LightrailDbTransactionStep {
        return {
            userId: auth.userId,
            id: `${plan.id}-${stepIndex}`,
            transactionId: plan.id,
            ...getSharedProperties(step)
        };
    }

    export function toLightrailTransactionStep(step: LightrailTransactionPlanStep): LightrailTransactionStep {
        return {
            rail: "lightrail",
            ...getSharedProperties(step)
        };
    }

    function getSharedProperties(step: LightrailTransactionPlanStep) {
        return {
            valueId: step.value.id,
            contactId: step.value.contactId,
            code: step.value.code,
            balanceBefore: step.value.balance,
            balanceAfter: step.value.balance != null ? step.value.balance + (step.amount || 0) : null,
            balanceChange: step.value.balance != null || step.amount != null ? (step.amount || 0) : null,
            usesRemainingBefore: step.value.usesRemaining != null ? step.value.usesRemaining : null,
            usesRemainingAfter: step.value.usesRemaining != null ? step.value.usesRemaining + (step.uses || 0) : null,
            usesRemainingChange: step.value.usesRemaining != null || step.uses != null ? (step.uses || 0) : null
        };
    }
}

export namespace StripeTransactionPlanStep {
    export function toStripeDbTransactionStep(step: StripeTransactionPlanStep, plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge): StripeDbTransactionStep {
        switch (step.type) {
            case "charge":
                return {
                    userId: auth.userId,
                    id: step.idempotentStepId,
                    transactionId: plan.id,
                    chargeId: step.chargeResult.id,
                    amount: -step.chargeResult.amount /* Note, chargeResult.amount is positive in Stripe but Lightrail treats debits as negative amounts on Steps. */,
                    charge: JSON.stringify(step.chargeResult)
                };
            case "refund":
                return {
                    userId: auth.userId,
                    id: step.idempotentStepId,
                    transactionId: plan.id,
                    chargeId: step.chargeId,
                    amount: step.refundResult.amount,
                    charge: JSON.stringify(step.refundResult)
                };
            case "capture": // Capture steps aren't persisted to the DB.
                return {
                    userId: auth.userId,
                    id: step.idempotentStepId,
                    transactionId: plan.id,
                    chargeId: step.captureResult.id,
                    amount: step.amount,
                    charge: JSON.stringify(step.captureResult)
                };
            default:
                throw new Error(`Unexpected stripe step. This should not happen. Step: ${JSON.stringify(step)}.`);
        }
    }

    export function toStripeTransactionStep(step: StripeTransactionPlanStep): StripeTransactionStep {
        const stripeTransactionStep: StripeTransactionStep = {
            rail: "stripe",
            chargeId: null,
            charge: null,
            amount: step.amount
        };
        switch (step.type) {
            case "charge":
                if (step.chargeResult) {
                    stripeTransactionStep.chargeId = step.chargeResult.id;
                    stripeTransactionStep.charge = step.chargeResult;
                    stripeTransactionStep.amount = -step.chargeResult.amount; // chargeResult.amount is positive in Stripe but Lightrail treats debits as negative amounts on Steps.
                }
                break;
            case "refund":
                if (step.refundResult) {
                    stripeTransactionStep.chargeId = step.chargeId;
                    stripeTransactionStep.charge = step.refundResult;
                    stripeTransactionStep.amount = step.refundResult.amount;
                }
                break;
            case "capture":
                if (step.captureResult) {
                    stripeTransactionStep.chargeId = step.captureResult.id;
                    stripeTransactionStep.charge = step.captureResult;
                    stripeTransactionStep.amount = step.amount;
                }
                break;
            default:
                throw new Error(`Unexpected stripe step. This should not happen. Step: ${JSON.stringify(step)}.`);
        }
        return stripeTransactionStep;
    }
}

export namespace InternalTransactionPlanStep {
    export function toInternalDbTransactionStep(step: InternalTransactionPlanStep, plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge): InternalDbTransactionStep {
        return {
            userId: auth.userId,
            id: crypto.createHash("sha1").update(plan.id + "/" + step.internalId).digest("base64"),
            transactionId: plan.id,
            ...getSharedProperties(step)
        };
    }

    export function toInternalTransactionStep(step: InternalTransactionPlanStep): InternalTransactionStep {
        return {
            rail: "internal",
            ...getSharedProperties(step)
        };
    }

    function getSharedProperties(step: InternalTransactionPlanStep) {
        return {
            internalId: step.internalId,
            balanceBefore: step.balance,
            balanceAfter: step.balance + step.amount /* step.amount is negative if debit */,
            balanceChange: step.amount
        };
    }
}

export namespace TransactionPlan {
    export function toTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan, simulated?: boolean): Transaction {
        const transaction: Transaction = {
            ...getSharedProperties(plan),
            totals: plan.totals,
            lineItems: plan.lineItems,
            steps: plan.steps.map(step => transactionPlanStepToTransactionStep(step)),
            paymentSources: plan.paymentSources && getSanitizedPaymentSources(plan),
            pending: !!plan.pendingVoidDate,
            pendingVoidDate: plan.pendingVoidDate || undefined,
            metadata: plan.metadata || null,
            createdBy: auth.teamMemberId
        };
        if (simulated) {
            transaction.simulated = true;
        }
        return transaction;
    }

    export function getSanitizedPaymentSources(plan: TransactionPlan): TransactionParty[] {
        let cleanSources: TransactionParty[] = [];
        for (let source of plan.paymentSources) {
            if (source.rail === "lightrail" && source.code) {
                // checking whether the code is generic without pulling the Value from the db again:
                // secret codes come back as lastFour, so if a step has a Value whose code matches the (full) code in the payment source, it means it's a generic code
                const genericCodeStep: LightrailTransactionPlanStep = (plan.steps.find(step => step.rail === "lightrail" && step.value.code === (source as LightrailTransactionParty).code && step.value.isGenericCode) as LightrailTransactionPlanStep);
                if (genericCodeStep) {
                    cleanSources.push(source);
                } else {
                    cleanSources.push({
                        rail: source.rail,
                        code: formatCodeForLastFourDisplay(source.code)
                    });
                }
            } else {
                cleanSources.push(source);
            }
        }
        return cleanSources;
    }

    function getSharedProperties(plan: TransactionPlan) {
        return {
            id: plan.id,
            transactionType: plan.transactionType,
            currency: plan.currency,
            createdDate: plan.createdDate,
            tax: plan.tax
        };
    }

    function transactionPlanStepToTransactionStep(step: TransactionPlanStep): TransactionStep {
        switch (step.rail) {
            case "lightrail":
                return LightrailTransactionPlanStep.toLightrailTransactionStep(step);
            case "stripe":
                return StripeTransactionPlanStep.toStripeTransactionStep(step);
            case "internal":
                return InternalTransactionPlanStep.toInternalTransactionStep(step);
        }
    }
}

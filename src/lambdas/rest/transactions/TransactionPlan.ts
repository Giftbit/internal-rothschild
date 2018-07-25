import * as stripe from "stripe";
import {
    DbTransaction,
    InternalDbTransactionStep,
    InternalTransactionStep,
    LightrailDbTransactionStep,
    LightrailTransactionStep,
    StripeDbTransactionStep,
    StripeTransactionStep,
    Transaction,
    TransactionPlanTotals,
    TransactionStep,
    TransactionType
} from "../../../model/Transaction";
import {Value} from "../../../model/Value";
import {LineItemResponse} from "../../../model/LineItem";
import {TransactionParty} from "../../../model/TransactionRequest";
import * as crypto from "crypto";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {codeLastFour} from "../../../model/DbCode";

export interface TransactionPlan {
    id: string;
    transactionType: TransactionType;
    currency: string;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[] | null;
    paymentSources: TransactionParty[] | null;
    steps: TransactionPlanStep[];
    createdDate: Date;
    metadata: object | null;
}

export type TransactionPlanStep =
    LightrailTransactionPlanStep
    | StripeTransactionPlanStep
    | InternalTransactionPlanStep;

export interface LightrailTransactionPlanStep {
    rail: "lightrail";
    value: Value;
    amount: number;
}

export interface StripeTransactionPlanStep {
    rail: "stripe";
    idempotentStepId: string;
    source?: string;
    customer?: string;
    maxAmount: number | null;
    amount: number;

    /**
     * Result of creating the charge in Stripe is only set if the plan is executed.
     */
    chargeResult?: stripe.charges.ICharge;
}

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
            userId: auth.giftbitUserId,
            id: `${plan.id}-${stepIndex}`,
            transactionId: plan.id,
            ...getSharedProperties(step)
        };
    }

    export function toLightrailTransactionStep(step: LightrailTransactionPlanStep): LightrailTransactionStep {
        return {
            rail: "lightrail",
            ...getSharedProperties(step),
        };
    }

    function getSharedProperties(step: LightrailTransactionPlanStep) {
        let sharedProperties = {
            valueId: step.value.id,
            contactId: step.value.contactId,
            code: step.value.code,
            balanceBefore: step.value.balance,
            balanceAfter: step.value.balance + step.amount,
            balanceChange: step.amount
        };
        if (step.value.valueRule !== null) {
            sharedProperties.balanceBefore = 0;
            sharedProperties.balanceAfter = 0;
        }
        return sharedProperties;
    }
}

export namespace StripeTransactionPlanStep {
    export function toStripeDbTransactionStep(step: StripeTransactionPlanStep, plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge): StripeDbTransactionStep {
        return {
            userId: auth.giftbitUserId,
            id: step.idempotentStepId,
            transactionId: plan.id,
            chargeId: step.chargeResult.id,
            amount: -step.chargeResult.amount /* Note, chargeResult.amount is positive in Stripe but Lightrail treats debits as negative amounts on Steps. */,
            charge: JSON.stringify(step.chargeResult)
        };
    }

    export function toStripeTransactionStep(step: StripeTransactionPlanStep): StripeTransactionStep {
        let stripeTransactionStep: StripeTransactionStep = {
            rail: "stripe",
            chargeId: null,
            charge: null,
            amount: step.amount
        };
        if (step.chargeResult) {
            stripeTransactionStep.chargeId = step.chargeResult.id;
            stripeTransactionStep.charge = step.chargeResult;
            stripeTransactionStep.amount = -step.chargeResult.amount /* Note, chargeResult.amount is positive in Stripe but Lightrail treats debits as negative amounts on Steps. */;
        }
        return stripeTransactionStep;
    }
}

export namespace InternalTransactionPlanStep {
    export function toInternalDbTransactionStep(step: InternalTransactionPlanStep, plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge): InternalDbTransactionStep {
        return {
            userId: auth.giftbitUserId,
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
    export function toDbTransaction(plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge): DbTransaction {
        return {
            userId: auth.giftbitUserId,
            ...getSharedProperties(plan),
            totals: JSON.stringify(plan.totals),
            lineItems: JSON.stringify(plan.lineItems),
            paymentSources: JSON.stringify(plan.paymentSources),
            metadata: JSON.stringify(plan.metadata)
        };
    }

    export function toTransaction(plan: TransactionPlan, simulated?: boolean): Transaction {
        const transaction: Transaction = {
            ...getSharedProperties(plan),
            totals: plan.totals,
            lineItems: plan.lineItems,
            steps: plan.steps.map(step => transactionPlanStepToTransactionStep(step)),
            paymentSources: plan.paymentSources ? plan.paymentSources.map(source => obscureCodes(source, plan.steps)) : null,
            metadata: plan.metadata || null
        };
        if (simulated) {
            transaction.simulated = true;
        }
        return transaction;
    }

    function getSharedProperties(plan: TransactionPlan) {
        return {
            id: plan.id,
            transactionType: plan.transactionType,
            currency: plan.currency,
            createdDate: plan.createdDate
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

    function obscureCodes(source: TransactionParty, steps: TransactionPlanStep[]): TransactionParty {
        if (source.rail === "lightrail" && source.code) {
            // checking whether the code is generic without pulling the Value from the db again:
            // secret codes come back as lastFour, so if a step has a Value whose code matches the (full) code in the payment source, it means it's a generic code
            const genericCodeStep: LightrailTransactionPlanStep = (steps.find(step => step.rail === "lightrail" && step.value.code === source.code) as LightrailTransactionPlanStep);
            if (genericCodeStep) {
                return source;
            } else {
                return {
                    rail: source.rail,
                    code: codeLastFour(source.code)
                };
            }
        } else {
            return source;
        }
    }
}

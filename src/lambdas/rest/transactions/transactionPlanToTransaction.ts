import {
    InternalTransactionStep,
    LightrailTransactionStep,
    StripeTransactionStep,
    Transaction,
    TransactionStep,
} from "../../../model/Transaction";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";

export function transactionPlanToTransaction(plan: TransactionPlan, simulated?: boolean): Transaction {
    const transaction: Transaction = {
        id: plan.id,
        transactionType: plan.transactionType,
        currency: plan.currency,
        totals: plan.totals,
        lineItems: plan.lineItems,
        steps: plan.steps.map(step => transactionPlanStepToTransactionStep(step, plan)),
        paymentSources: plan.paymentSources,
        metadata: plan.metadata || null,
        createdDate: plan.createdDate
    };
    if (simulated) {
        transaction.simulated = true;
    }
    return transaction;
}

function transactionPlanStepToTransactionStep(step: TransactionPlanStep, plan: TransactionPlan): TransactionStep {
    switch (step.rail) {
        case "lightrail":
            return lightrailTransactionPlanStepToTransactionStep(step);
        case "stripe":
            return stripeTransactionPlanStepToTransactionStep(step);
        case "internal":
            return internalTransactionPlanStepToTransactionStep(step);
    }
}

function lightrailTransactionPlanStepToTransactionStep(step: LightrailTransactionPlanStep): LightrailTransactionStep {
    return {
        rail: "lightrail",
        valueId: step.value.id,
        contactId: step.value.contactId,
        code: step.value.code,
        balanceBefore: step.value.balance,
        balanceAfter: step.value.balance + step.amount,
        balanceChange: step.amount
    };
}

function stripeTransactionPlanStepToTransactionStep(step: StripeTransactionPlanStep): StripeTransactionStep {
    const res: StripeTransactionStep = {
        rail: "stripe",
        amount: step.amount,
    };
    if (step.chargeResult) {
        res.chargeId = step.chargeResult.id;
        res.charge = step.chargeResult;
    } else {
        res.chargeId = null;
        res.charge = null;
    }
    return res;
}

function internalTransactionPlanStepToTransactionStep(step: InternalTransactionPlanStep): InternalTransactionStep {
    return TransactionPlanStep.toInternalTransactionStep(step);
}

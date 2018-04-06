import {
    InternalTransactionStep,
    LightrailTransactionStep, StripeTransactionStep, Transaction,
    TransactionStep,
} from "../../../model/Transaction";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep, StripeTransactionPlanStep, TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";

export function transactionPlanToTransaction(plan: TransactionPlan): Transaction {
    return {
        transactionId: plan.transactionId,
        transactionType: plan.transactionType,
        cart: plan.cart,
        steps: plan.steps.map(transactionPlanStepToTransactionStep),
        remainder: plan.remainder
    };
}

function transactionPlanStepToTransactionStep(step: TransactionPlanStep): TransactionStep {
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
        valueStoreId: step.valueStore.valueStoreId,
        valueStoreType: step.valueStore.valueStoreType,
        currency: step.valueStore.currency,
        customerId: step.valueStore.customerId,
        codeLastFour: step.valueStore.codeLastFour,
        valueBefore: step.valueStore.value,
        valueAfter: step.valueStore.value + step.amount,
        valueChange: step.amount
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
    }
    return res;
}

function internalTransactionPlanStepToTransactionStep(step: InternalTransactionPlanStep): InternalTransactionStep {
    return {
        rail: "internal",
        id: step.internalId,
        valueBefore: step.value,
        valueAfter: step.value + step.amount,
        valueChange: step.amount
    };
}

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
import {nowInDbPrecision} from "../../../dbUtils";

export function transactionPlanToTransaction(plan: TransactionPlan, simulated?: boolean): Transaction {
    const transaction: Transaction = {
        id: plan.id,
        transactionType: plan.transactionType,
        cart: plan.cart,
        steps: plan.steps.map(transactionPlanStepToTransactionStep),
        remainder: plan.remainder,
        createdDate: nowInDbPrecision()
    };
    if (simulated) {
        transaction.simulated = true;
    }
    return transaction;
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
        valueId: step.value.id,
        currency: step.value.currency,
        contactId: step.contactId,
        codeLastFour: step.codeLastFour,
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
    }
    return res;
}

function internalTransactionPlanStepToTransactionStep(step: InternalTransactionPlanStep): InternalTransactionStep {
    return {
        rail: "internal",
        id: step.internalId,
        balanceBefore: step.value,
        balanceAfter: step.value + step.amount,
        balanceChange: step.amount
    };
}

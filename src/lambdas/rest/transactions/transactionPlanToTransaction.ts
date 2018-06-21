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
        currency: plan.currency,
        totals: plan.totals,
        lineItems: plan.lineItems,
        steps: plan.steps.map(step => transactionPlanStepToTransactionStep(step, plan)),
        paymentSources: plan.paymentSources, // .map(source => transactionPlanSourcesToTransactionSources(source)),
        metadata: plan.metadata || null,
        createdDate: nowInDbPrecision()
    };
    if (simulated) {
        transaction.simulated = true;
    }
    return transaction;
}

function transactionPlanStepToTransactionStep(step: TransactionPlanStep, plan: TransactionPlan): TransactionStep {
    switch (step.rail) {
        case "lightrail":
            return lightrailTransactionPlanStepToTransactionStep(step, plan);
        case "stripe":
            return stripeTransactionPlanStepToTransactionStep(step, plan);
        case "internal":
            return internalTransactionPlanStepToTransactionStep(step, plan);
    }
}

function lightrailTransactionPlanStepToTransactionStep(step: LightrailTransactionPlanStep, plan: TransactionPlan): LightrailTransactionStep {
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

function stripeTransactionPlanStepToTransactionStep(step: StripeTransactionPlanStep, plan: TransactionPlan): StripeTransactionStep {
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

function internalTransactionPlanStepToTransactionStep(step: InternalTransactionPlanStep, plan: TransactionPlan): InternalTransactionStep {
    return {
        rail: "internal",
        id: step.internalId,
        balanceBefore: step.balance,
        balanceAfter: step.balance + step.amount,
        balanceChange: step.amount
    };
}

// function transactionPlanSourcesToTransactionSources(source: TransactionParty) {
//     switch (source.rail) {
//         case "lightrail":
//             return source;
//         case "stripe":
//             console.log("\n\nHERE");
//             console.log(JSON.stringify(source, null, 4));
//             return {
//                 rail: source.rail,
//                 source: source.source
//             };
//         case "internal":
//             return source;
//     }
// }

import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlanStep
} from "./TransactionPlan";

// Because after 14 years of programming I still get this wrong.
const aFirst = -1;
const bFirst = 1;

/**
 * Comparison function for sorting TransactionPlanSteps into the order they should
 * be drawn down against.  This is key business logic.
 */
export function compareTransactionPlanSteps(a: TransactionPlanStep, b: TransactionPlanStep): number {
    switch (a.rail) {
        case "lightrail":
            switch (b.rail) {
                case "lightrail":
                    return compareLightrailTransactionPlanSteps(a, b);
                case "stripe":
                    return aFirst;
                case "internal":
                    return b.beforeLightrail ? bFirst : aFirst;
            }
            break;
        case "stripe":
            switch (b.rail) {
                case "lightrail":
                    return bFirst;
                case "stripe":
                    return compareStripeTransactionPlanSteps(a, b);
                case "internal":
                    return b.beforeLightrail ? bFirst : aFirst;
            }
            break;
        case "internal":
            switch (b.rail) {
                case "lightrail":
                    return a.beforeLightrail ? aFirst : bFirst;
                case "stripe":
                    return a.beforeLightrail ? aFirst : bFirst;
                case "internal":
                    return compareInternalTransactionPlanSteps(a, b);
            }
            break;
    }
}

function compareLightrailTransactionPlanSteps(a: LightrailTransactionPlanStep, b: LightrailTransactionPlanStep): number {
    // TODO this logic is blocked on defining the value store types
    if (a.value.pretax && !b.value.pretax) {
        return aFirst;
    }
    if (!a.value.pretax && b.value.pretax) {
        return bFirst;
    }
    if (a.valueStore.discount) {
        return aFirst;
    }
    if (b.valueStore.discount) {
        return bFirst;
    }
    return a.value.id < b.value.id ? aFirst : bFirst;
}

function compareStripeTransactionPlanSteps(a: StripeTransactionPlanStep, b: StripeTransactionPlanStep): number {
    return b.priority - a.priority;
}

function compareInternalTransactionPlanSteps(a: InternalTransactionPlanStep, b: InternalTransactionPlanStep): number {
    if (a.pretax && !b.pretax) {
        return aFirst;
    }
    if (!a.pretax && b.pretax) {
        return bFirst;
    }
    if (a.beforeLightrail && !b.beforeLightrail) {
        return aFirst;
    }
    if (b.beforeLightrail && !a.beforeLightrail) {
        return bFirst;
    }
    return a.internalId < b.internalId ? aFirst : bFirst;
}

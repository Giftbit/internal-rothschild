import {TransactionPlan} from "./TransactionPlan";

export function executeTransactionPlan(plan: TransactionPlan): Promise<void> {
    const messy = plan.steps.find(step => step.rail !== "lightrail" && step.rail !== "internal");
    return messy ? executeMessyTransactionPlan(plan) : executePureTransactionPlan(plan);
}

/**
 * Execute a transaction plan that can be done as a single SQL transaction
 * locking on ValueStores.
 */
function executePureTransactionPlan(plan: TransactionPlan): Promise<void> {
    throw new Error("Not implemented");
}

/**
 * Execute a transaction plan that transacts against other systems and requires
 * create-pending and capture-pending logic.
 */
function executeMessyTransactionPlan(plan: TransactionPlan): Promise<void> {
    throw new Error("Not implemented");
}

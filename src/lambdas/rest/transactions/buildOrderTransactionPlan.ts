import {TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {OrderRequest} from "../../../model/TransactionRequest";
import {getRuleFromCache} from "./getRuleFromCache";

export function buildOrderTransactionPlan(order: OrderRequest, steps: TransactionPlanStep[]): TransactionPlan {
    const now = new Date();

    // TODO initialize from order.cart
    const cart = null;

    let remainder = 0;  // TODO get actual order total from cart
    for (let stepIx = 0; stepIx < steps.length && remainder > 0; stepIx++) {
        const step = steps[stepIx];
        switch (step.rail) {
            case "lightrail":
                if (step.valueStore.frozen || !step.valueStore.active || step.valueStore.expired || step.valueStore.uses === 0) {
                    // Ideally those won't be returned in the query for efficiency but it's good to be paranoid here.
                    break;
                }
                if (step.valueStore.startDate && step.valueStore.startDate > now) {
                    break;
                }
                if (step.valueStore.endDate && step.valueStore.endDate < now) {
                    break;
                }
                if (step.valueStore.redemptionRule) {
                    const context = {
                        cart: order.cart
                    };
                    if (!getRuleFromCache(step.valueStore.redemptionRule.rule).evaluateToBoolean(context)) {
                        break;
                    }
                }

                if (step.valueStore.valueRule) {
                    step.amount = -Math.min(remainder, getRuleFromCache(step.valueStore.valueRule.rule).evaluateToNumber(context) | 0);
                } else {
                    step.amount = -Math.min(remainder, step.valueStore.value);
                }
                break;
            case "stripe":
                if (step.maxAmount) {
                    step.amount = -Math.min(remainder, step.maxAmount);
                } else {
                    step.amount = -remainder;
                }
                break;
            case "internal":
                step.amount = -Math.min(remainder, step.value);
                break;
        }
        remainder += step.amount;
    }

    return {
        transactionId: order.transactionId,
        transactionType: "order",
        cart,
        steps: steps,
        remainder
    };
}

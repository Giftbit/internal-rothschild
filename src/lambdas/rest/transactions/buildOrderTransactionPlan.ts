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
                if (step.value.frozen || !step.value.active || step.value.expired || step.value.uses === 0) {
                    // Ideally those won't be returned in the query for efficiency but it's good to be paranoid here.
                    break;
                }
                if (step.value.startDate && step.value.startDate > now) {
                    break;
                }
                if (step.value.endDate && step.value.endDate < now) {
                    break;
                }
                if (step.value.redemptionRule) {
                    const context = {
                        cart: order.cart
                    };
                    if (!getRuleFromCache(step.value.redemptionRule.rule).evaluateToBoolean(context)) {
                        break;
                    }
                }

                if (step.value.valueRule) {
                    step.amount = -Math.min(remainder, getRuleFromCache(step.value.valueRule.rule).evaluateToNumber(context) | 0);
                } else {
                    step.amount = -Math.min(remainder, step.value.balance);
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
        id: order.id,
        transactionType: "order",
        cart,
        steps: steps,
        remainder
    };
}

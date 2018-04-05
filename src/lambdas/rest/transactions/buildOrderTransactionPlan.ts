import {TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {OrderRequest} from "../../../model/TransactionRequest";

export function buildOrderTransactionPlan(order: OrderRequest, steps: TransactionPlanStep[]): TransactionPlan {
    const now = new Date();

    // TODO initialize from order.cart
    const cart = null;

    let remainder = 0;  // TODO get actual order total from cart
    for (let stepIx = 0; stepIx < steps.length && remainder > 0; stepIx++) {
        const step = steps[stepIx];
        switch (step.rail) {
            case "lightrail":
                if (step.valueStore.frozen || !step.valueStore.active || step.valueStore.expired) {
                    // Ideally those won't be returned in the query for efficiency but it's good to be paranoid here.
                    break;
                }
                if (step.valueStore.startDate && step.valueStore.startDate > now) {
                    break;
                }
                if (step.valueStore.endDate && step.valueStore.endDate < now) {
                    break;
                }
                // TODO redemption rules, value rules
                step.amount = -Math.max(remainder, step.valueStore.value);
                break;
            case "stripe":
                if (step.maxAmount) {
                    step.amount = -Math.max(remainder, step.maxAmount);
                } else {
                    step.amount = -remainder;
                }
                break;
            case "internal":
                step.amount = -Math.max(remainder, step.value);
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

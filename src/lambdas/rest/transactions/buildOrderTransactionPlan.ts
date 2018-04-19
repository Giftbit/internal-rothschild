import {TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {OrderRequest} from "../../../model/TransactionRequest";
import {getRuleFromCache} from "./getRuleFromCache";
import {LineItemRequest, LineItemResponse} from "../../../model/LineItem";

export function buildOrderTransactionPlan(order: OrderRequest, pretaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    const now = new Date();

    // TODO initialize from order.lineItems
    let lineItemResponses = initializeLineItemResponses(order.lineItems);


    let remainder = 0;  // TODO get actual order total from lineItems
    for (let stepIx = 0; stepIx < postTaxSteps.length && remainder > 0; stepIx++) {
        const step = postTaxSteps[stepIx];
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
                // todo - is this the right time do be doing this?
                if (step.valueStore.redemptionRule) {
                    const context = {
                        lineItems: order.lineItems
                    };
                    if (!getRuleFromCache(step.valueStore.redemptionRule.rule).evaluateToBoolean(context)) {
                        break;
                    }
                }

                for (const item of lineItems) {
                    // does valueStore apply to item?


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
        lineItems: lineItems,
        steps: postTaxSteps,
        remainder
    };
}

function initializeLineItemResponses(lineItemRequests: LineItemRequest[]) {
    let lineItemResponses: LineItemResponse[] = [];
    for (let lineItem of lineItemRequests) {
        lineItem.quantity = lineItem.quantity ? lineItem.quantity : 1;
        let lineItemResponse: LineItemResponse = {
            ...lineItem,
            lineTotal: {
                subtotal: lineItem.unitPrice * lineItem.quantity,
                pretaxDiscount: 0,
                tax: 0,
                postTaxDiscount: 0,
                payable: 0
            }
        };
        lineItemResponses.push(lineItemResponse)
    }
    return lineItemResponses;
}


function doTransactionSteps() {

}

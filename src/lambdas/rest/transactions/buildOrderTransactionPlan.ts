import {
    calculateRemainder,
    LightrailTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";
import {OrderRequest} from "../../../model/TransactionRequest";
import {getRuleFromCache} from "./getRuleFromCache";
import {LineItemResponse} from "../../../model/LineItem";
import {ValueStore} from "../../../model/ValueStore";

const bankersRounding = require('bankers-rounding');

export function buildOrderTransactionPlan(order: OrderRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let transactionPlan = initializeTransactionResponse(order, preTaxSteps.concat(postTaxSteps));
    transactionPlan = processTransactionSteps(preTaxSteps, transactionPlan);
    transactionPlan = applyTax(transactionPlan);
    transactionPlan.remainder = calculateRemainder(transactionPlan.lineItems);
    transactionPlan = processTransactionSteps(postTaxSteps, transactionPlan);
    transactionPlan.remainder = calculateRemainder(transactionPlan.lineItems);

    // calculate payable on each lineItem
    transactionPlan.totals = {
        subTotal: 0,
        tax: 0,
        discount: 0,
        payable: 0
    };

    for (let item of transactionPlan.lineItems) {
        item.lineTotal.payable = item.lineTotal.subtotal + item.lineTotal.tax - item.lineTotal.discount
        transactionPlan.totals.subTotal += item.lineTotal.subtotal;
        transactionPlan.totals.tax += item.lineTotal.tax;
        transactionPlan.totals.discount += item.lineTotal.discount;
        transactionPlan.totals.payable += item.lineTotal.payable
    }

    console.log(`transactionPlan: ${JSON.stringify(transactionPlan)}`);
    return transactionPlan;
}

function initializeTransactionResponse(order: OrderRequest, steps: TransactionPlanStep[]): TransactionPlan {
    let lineItemResponses: LineItemResponse[] = [];
    for (let lineItem of order.lineItems) {
        lineItem.quantity = lineItem.quantity ? lineItem.quantity : 1;
        const subtotal = lineItem.unitPrice * lineItem.quantity;
        let lineItemResponse: LineItemResponse = {
            ...lineItem,
            lineTotal: {
                subtotal: subtotal,
                taxable: subtotal,
                tax: 0,
                discount: 0,
                remainder: subtotal,
                payable: 0
            }
        };
        lineItemResponses.push(lineItemResponse)
    }
    return {
        transactionId: order.transactionId,
        transactionType: "debit",
        lineItems: lineItemResponses,
        steps: steps,
        remainder: calculateRemainder(lineItemResponses)
    };
}

function isValueStoreInInvalidStateForRedemption(valueStore: ValueStore): boolean {
    const now = new Date();

    if (valueStore.frozen || !valueStore.active || valueStore.expired || valueStore.uses === 0) {
        return true;
    }
    if (valueStore.startDate && valueStore.startDate > now) {
        return true;
    }
    if (valueStore.endDate && valueStore.endDate < now) {
        return true;
    }
}

function processTransactionSteps(steps: TransactionPlanStep[], transactionPlan: TransactionPlan): TransactionPlan {
    for (let stepsIndex = 0; stepsIndex < steps.length /* && transactionPlan.remainder > 0 */; stepsIndex++) {
        const step = steps[stepsIndex];
        switch (step.rail) {
            case "lightrail":
                transactionPlan = processLightrailTransactionStep(step, transactionPlan);
                break;
            case "stripe":
                throw new Error("not yet implemented");
            case "internal":
                throw new Error("not yet implemented");
        }
    }
    return transactionPlan;
}

function processLightrailTransactionStep(step: LightrailTransactionPlanStep, transactionPlan: TransactionPlan): TransactionPlan {
    console.log(`processing ValueStore ${JSON.stringify(step)}.`);
    let valueStore = step.valueStore;
    if (isValueStoreInInvalidStateForRedemption(valueStore)) {
        return transactionPlan;
    }
    for (let index in transactionPlan.lineItems) {
        const item = transactionPlan.lineItems[index];
        if (item.lineTotal.remainder === 0) {
            break; // the item has been paid for. you can skip.
        }
        if (valueStore.redemptionRule) {
            const context = {
                lineItems: transactionPlan.lineItems,
                currentLineItem: item
            };
            if (!getRuleFromCache(valueStore.redemptionRule.rule).evaluateToBoolean(context)) {
                console.log(`ValueStore ${JSON.stringify(valueStore)} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                break;
            }
        }

        console.log(`ValueStore ${JSON.stringify(valueStore)} CAN be applied to ${JSON.stringify(item)}.`);
        if (item.lineTotal.remainder > 0) {
            let amount: number;
            if (valueStore.valueRule) {
                amount = Math.min(item.lineTotal.remainder, getRuleFromCache(valueStore.valueRule.rule).evaluateToNumber(context) | 0);
            } else {
                amount = Math.min(item.lineTotal.remainder, valueStore.value);
                valueStore.value -= amount;
                step.amount -= amount;
            }

            item.lineTotal.remainder -= amount;
            if (valueStore.discount) {
                item.lineTotal.discount += amount;
            }
        }
    }
    return transactionPlan
}

function applyTax(transactionPlan: TransactionPlan): TransactionPlan {
    for (let item of transactionPlan.lineItems) {
        let tax = 0;
        item.lineTotal.taxable = item.lineTotal.subtotal - item.lineTotal.discount;
        if (item.taxRate >= 0) {
            // todo export to utils
            tax = bankersRounding(item.taxRate * item.lineTotal.taxable);
        }
        item.lineTotal.tax = tax;
        item.lineTotal.remainder += tax;
    }
    return transactionPlan;
}
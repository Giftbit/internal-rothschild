import * as bankersRounding from "bankers-rounding";
import * as log from "loglevel";
import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {OrderRequest} from "../../../model/TransactionRequest";
import {getRuleFromCache} from "./getRuleFromCache";
import {LineItemResponse} from "../../../model/LineItem";
import {Value} from "../../../model/Value";

export function buildOrderTransactionPlan(order: OrderRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let transactionPlan = initializeOrderTransactionPlan(order, preTaxSteps.concat(postTaxSteps));
    processTransactionSteps(preTaxSteps, transactionPlan);
    applyTax(transactionPlan);
    processTransactionSteps(postTaxSteps, transactionPlan);
    calculateTotalsFromLineItems(transactionPlan);
    log.debug("transactionPlan:", transactionPlan);

    transactionPlan.steps = transactionPlan.steps.filter(s => s.amount !== 0);
    return transactionPlan;
}

function initializeOrderTransactionPlan(order: OrderRequest, steps: TransactionPlanStep[]): TransactionPlan {
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
        lineItemResponses.push(lineItemResponse);
    }
    return {
        id: order.id,
        transactionType: "order",
        currency: order.currency,
        lineItems: lineItemResponses,
        steps: steps,
        totals: {
            subTotal: 0,
            tax: 0,
            discount: 0,
            payable: 0,
            remainder: calculateRemainderFromLineItems(lineItemResponses),
        },
        metadata: order.metadata,
        paymentSources: order.sources   // TODO if secure code, only return last four
    };
}

function isValueRedeemable(value: Value): boolean {
    const now = new Date();

    if (value.frozen || !value.active || value.endDate > now || value.uses === 0) {
        return false;
    }
    if (value.startDate && value.startDate > now) {
        return false;
    }
    if (value.endDate && value.endDate < now) {
        return false;
    }
    return true;
}

function processTransactionSteps(steps: TransactionPlanStep[], transactionPlan: TransactionPlan): void {
    for (let stepsIndex = 0; stepsIndex < steps.length; stepsIndex++) {
        const step = steps[stepsIndex];
        switch (step.rail) {
            case "lightrail":
                processLightrailTransactionStep(step, transactionPlan);
                break;
            case "stripe":
                throw new Error("not yet implemented");
            case "internal":
                throw new Error("not yet implemented");
        }
    }
}

function processLightrailTransactionStep(step: LightrailTransactionPlanStep, transactionPlan: TransactionPlan): void {
    log.debug("processing ValueStore", step);
    let value = step.value;
    if (!isValueRedeemable(value)) {
        return;
    }
    for (let index in transactionPlan.lineItems) {
        const item = transactionPlan.lineItems[index];
        if (item.lineTotal.remainder === 0) {
            break; // The item has been paid for, skip.
        }
        if (value.redemptionRule) {
            const context = {
                lineItems: transactionPlan.lineItems,
                currentLineItem: item
            };
            if (!getRuleFromCache(value.redemptionRule.rule).evaluateToBoolean(context)) {
                log.debug(`ValueStore ${JSON.stringify(value)} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                break;
            }
        }

        log.debug(`ValueStore ${JSON.stringify(value)} CAN be applied to ${JSON.stringify(item)}.`);
        if (item.lineTotal.remainder > 0) {
            let amount: number;
            if (value.valueRule) {
                amount = Math.min(item.lineTotal.remainder, getRuleFromCache(value.valueRule.rule).evaluateToNumber(context) | 0);
            } else {
                amount = Math.min(item.lineTotal.remainder, value.balance);
                value.balance -= amount;
                step.amount -= amount;
            }

            item.lineTotal.remainder -= amount;
            if (value.discount) {
                item.lineTotal.discount += amount;
            }
        }
    }
}

function applyTax(transactionPlan: TransactionPlan): void {
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
}

function calculateRemainderFromLineItems(lineItems: LineItemResponse[]): number {
    let remainder = 0;
    for (const item of lineItems) {
        remainder += item.lineTotal.remainder;
    }
    return remainder;
}

function calculateTotalsFromLineItems(transactionPlan: TransactionPlan): void {
    for (let item of transactionPlan.lineItems) {
        item.lineTotal.payable = item.lineTotal.subtotal + item.lineTotal.tax - item.lineTotal.discount;
        transactionPlan.totals.subTotal += item.lineTotal.subtotal;
        transactionPlan.totals.tax += item.lineTotal.tax;
        transactionPlan.totals.discount += item.lineTotal.discount;
        transactionPlan.totals.payable += item.lineTotal.payable;
    }
    transactionPlan.totals.remainder = calculateRemainderFromLineItems(transactionPlan.lineItems);
}

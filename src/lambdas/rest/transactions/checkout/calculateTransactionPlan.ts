import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {Value} from "../../../../model/Value";
import {RuleContext} from "../RuleContext";
import {CheckoutTransactionPlan} from "./CheckoutTransactionPlan";
import {bankersRounding} from "../../../utils/moneyUtils";
import * as log from "loglevel";

export function calculateCheckoutTransactionPlan(checkout: CheckoutRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let transactionPlan = new CheckoutTransactionPlan(checkout, preTaxSteps.concat(postTaxSteps));
    log.info(`Build checkout transaction plan: ${JSON.stringify(transactionPlan)}`);
    evaluateTransactionSteps(preTaxSteps, transactionPlan);
    transactionPlan.calculateTaxAndSetOnLineItems();
    evaluateTransactionSteps(postTaxSteps, transactionPlan);
    transactionPlan.calculateTotalsFromLineItems();

    transactionPlan.steps = transactionPlan.steps.filter(s => s.amount !== 0);
    return transactionPlan;
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

function evaluateTransactionSteps(steps: TransactionPlanStep[], transactionPlan: TransactionPlan): void {
    for (let stepsIndex = 0; stepsIndex < steps.length; stepsIndex++) {
        const step = steps[stepsIndex];
        switch (step.rail) {
            case "lightrail":
                evaluateLightrailTransactionStep(step, transactionPlan);
                break;
            case "stripe":
                // console.log("\nTXN PLAN WHEN CALCULATING STRIPE STEP: \n" + JSON.stringify(transactionPlan, null, 4));
                evaluateStripeTransactionStep(step, transactionPlan);
                break;
            // throw new Error("not yet implemented");
            case "internal":
                throw new Error("not yet implemented");
        }
    }
}

function evaluateLightrailTransactionStep(step: LightrailTransactionPlanStep, transactionPlan: TransactionPlan): void {
    log.info(`Processing ValueStore ${JSON.stringify(step)}.`);

    let value = step.value;
    if (!isValueRedeemable(value)) {
        return;
    }
    for (let index in transactionPlan.lineItems) {
        const item = transactionPlan.lineItems[index];
        if (item.lineTotal.remainder > 0) {
            if (value.redemptionRule) {
                if (!new RuleContext(transactionPlan.totals, transactionPlan.lineItems, item).evaluateRedemptionRule(value.redemptionRule)) {
                    log.info(`ValueStore ${JSON.stringify(value)} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                    continue;
                }
            }

            log.info(`ValueStore ${JSON.stringify(value)} CAN be applied to ${JSON.stringify(item)}.`);
            let amount: number;
            if (value.valueRule) {
                let valueFromRule = new RuleContext(transactionPlan.totals, transactionPlan.lineItems, item).evaluateValueRule(value.valueRule);
                amount = Math.min(item.lineTotal.remainder, bankersRounding(valueFromRule, 0) | 0);
                step.amount -= amount;
            } else {
                amount = Math.min(item.lineTotal.remainder, getAvailableBalance(value, step));
                step.amount -= amount;
            }
            item.lineTotal.remainder -= amount;
            if (value.discount) {
                item.lineTotal.discount += amount;
            }
        } else {
            // The item has been paid for, skip.
        }
    }
}

function evaluateStripeTransactionStep(step, transactionPlan): void {
    // console.log("STEP\n" + JSON.stringify(step, null, 4));

    let amount: number = 0;

    for (let item of transactionPlan.lineItems) {
        if (step.maxAmount) {
            if (amount + item.lineTotal.remainder <= step.maxAmount) {
                amount += item.lineTotal.remainder;
                item.lineTotal.remainder = 0;
            } else {
                const difference: number = step.maxAmount - amount;
                amount = step.maxAmount;
                item.lineTotal.remainder -= difference;
            }
        }
        else {  // charge full remainder for each line item to Stripe
            amount += item.lineTotal.remainder;
            item.lineTotal.remainder = 0;
        }
    }

    step.amount += amount;
    // console.log("STEP after eval\n" + JSON.stringify(step, null, 4));
}

// this seems to have disappeared in the merge: where did it go?
//
// function applyTax(transactionPlan: TransactionPlan): void {
//     for (let item of transactionPlan.lineItems) {
//         let tax = 0;
//         item.lineTotal.taxable = item.lineTotal.subtotal - item.lineTotal.discount;
//         if (item.taxRate >= 0) {
//             tax = bankersRounding(item.taxRate * item.lineTotal.taxable, 0);
//         }
//         item.lineTotal.tax = tax;
//         item.lineTotal.remainder += tax;
//     }

function getAvailableBalance(value: Value, step: LightrailTransactionPlanStep): number {
    return value.balance + step.amount;
}
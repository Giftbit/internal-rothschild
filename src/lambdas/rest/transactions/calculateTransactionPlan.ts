import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {CheckoutRequest} from "../../../model/TransactionRequest";
import {Value} from "../../../model/Value";
import {RuleContext} from "./RuleContext";
import {bankersRounding} from "../../utils/moneyUtils";

const debug = false;

export function calculateTransactionPlan(checkout: CheckoutRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let transactionPlan = new TransactionPlan(checkout, preTaxSteps.concat(postTaxSteps));
    console.log(`\nbuild checkout transaction plan:\n${JSON.stringify(transactionPlan)}\n\n`);
    processTransactionSteps(preTaxSteps, transactionPlan);
    applyTax(transactionPlan);
    processTransactionSteps(postTaxSteps, transactionPlan);
    transactionPlan.calculateTotalsFromLineItems();
    debug && console.log(`transactionPlan: ${JSON.stringify(transactionPlan)}`);

    transactionPlan.steps = transactionPlan.steps.filter(s => s.amount !== 0); // todo - I'm not sure if we want this?
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
    console.log(`processing ValueStore ${JSON.stringify(step)}.`);
    if (step.amount < 0) {
        throw "wtf m8"
    }
    let value = step.value;
    if (!isValueRedeemable(value)) {
        return;
    }
    const date = new Date();
    for (let index in transactionPlan.lineItems) {
        console.log(date.getMilliseconds() + ": index = " + index);
        const item = transactionPlan.lineItems[index];
        if (item.lineTotal.remainder === 0) {
            continue; // The item has been paid for, skip.
        }
        if (value.redemptionRule) {
            if (!new RuleContext(transactionPlan.totals, transactionPlan.lineItems, item).evaluateRedemptionRule(value.redemptionRule)) {
                console.log(`ValueStore ${JSON.stringify(value)} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                continue;
            }
        }

        debug && console.log(`ValueStore ${JSON.stringify(value)} CAN be applied to ${JSON.stringify(item)}.`);
        if (item.lineTotal.remainder > 0) {
            let amount: number;
            if (value.valueRule) {
                amount = Math.min(item.lineTotal.remainder, new RuleContext(transactionPlan.totals, transactionPlan.lineItems, item).evaluateValueRule(value.valueRule) | 0);
                step.amount -= amount;
            } else {
                amount = Math.min(item.lineTotal.remainder, value.balance);
                value.balance -= amount;
                step.amount -= amount;
            }

            item.lineTotal.remainder -= amount;
            if (value.discount) {
                item.lineTotal.discount += amount;
            }
        } else {
            // todo - this is an odd case? this can't really happen????
        }

    }
    // todo - if transacted against, reduce uses. This means that
}

function applyTax(transactionPlan: TransactionPlan): void {
    for (let item of transactionPlan.lineItems) {
        let tax = 0;
        item.lineTotal.taxable = item.lineTotal.subtotal - item.lineTotal.discount;
        if (item.taxRate >= 0) {
            tax = bankersRounding(item.taxRate * item.lineTotal.taxable, 0 /* todo - the currency and number of decimal places should be taken from the order or lineItem */);
        }
        item.lineTotal.tax = tax;
        item.lineTotal.remainder += tax;
    }
}
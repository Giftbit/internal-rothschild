import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "../TransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {Value} from "../../../../model/Value";
import {RuleContext} from "../RuleContext";
import {CheckoutTransactionPlan} from "./CheckoutTransactionPlan";
import {bankersRounding} from "../../../../utils/moneyUtils";
import * as log from "loglevel";

export function calculateCheckoutTransactionPlan(checkout: CheckoutRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let transactionPlan = new CheckoutTransactionPlan(checkout, preTaxSteps.concat(postTaxSteps));
    log.info(`Build checkout transaction plan: ${JSON.stringify(transactionPlan)}`);
    calculateAmountsForTransactionSteps(preTaxSteps, transactionPlan);
    transactionPlan.calculateTaxAndSetOnLineItems();
    calculateAmountsForTransactionSteps(postTaxSteps, transactionPlan);
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

function calculateAmountsForTransactionSteps(steps: TransactionPlanStep[], transactionPlan: TransactionPlan): void {
    for (let stepsIndex = 0; stepsIndex < steps.length; stepsIndex++) {
        const step = steps[stepsIndex];
        switch (step.rail) {
            case "lightrail":
                calculateAmountForLightrailTransactionStep(step, transactionPlan);
                break;
            case "stripe":
                calculateAmountForStripeTransactionStep(step, transactionPlan);
                break;
            case "internal":
                calculateAmountForInternalTransactionStep(step, transactionPlan);
                break;
        }
    }
}

function calculateAmountForLightrailTransactionStep(step: LightrailTransactionPlanStep, transactionPlan: TransactionPlan): void {
    log.info(`Processing ValueStore ${JSON.stringify(step)}.`);

    let value = step.value;
    if (!isValueRedeemable(value)) {
        return;
    }
    for (const index in transactionPlan.lineItems) {
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

function calculateAmountForStripeTransactionStep(step, transactionPlan): void {
    let amount: number = 0;

    for (const item of transactionPlan.lineItems) {
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
}

function calculateAmountForInternalTransactionStep(step: InternalTransactionPlanStep, transactionPlan): void {
    for (const item of transactionPlan.lineItems) {
        const amount = Math.min(item.lineTotal.remainder, step.balance);
        step.balance -= amount;
        step.amount -= amount;
        item.lineTotal.remainder -= amount;
        // todo - Q: can internal steps be considered as discounts?
    }
}

function getAvailableBalance(value: Value, step: LightrailTransactionPlanStep): number {
    return value.balance + step.amount;
}

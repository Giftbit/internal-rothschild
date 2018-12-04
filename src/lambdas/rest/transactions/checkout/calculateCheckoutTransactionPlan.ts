import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeChargeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "../TransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {Value} from "../../../../model/Value";
import {RuleContext} from "../rules/RuleContext";
import {CheckoutTransactionPlan} from "./CheckoutTransactionPlan";
import {bankersRounding} from "../../../../utils/moneyUtils";
import log = require("loglevel");

/**
 * Build a TransactionPlan for checkout.  This mutates the steps by setting the amount.
 */
export function calculateCheckoutTransactionPlan(checkout: CheckoutRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    // Reset step amounts in case they were set in a previous call to this function.
    for (const step of preTaxSteps) {
        step.amount = 0;
        if ((step as LightrailTransactionPlanStep).uses != null) {
            (step as LightrailTransactionPlanStep).uses = 0;
        }
    }
    for (const step of postTaxSteps) {
        step.amount = 0;
        if ((step as LightrailTransactionPlanStep).uses != null) {
            (step as LightrailTransactionPlanStep).uses = 0;
        }
    }

    let transactionPlan = new CheckoutTransactionPlan(checkout, preTaxSteps.concat(postTaxSteps));
    log.info(`Build checkout transaction plan: ${JSON.stringify(transactionPlan)}`);
    calculateAmountsForTransactionSteps(preTaxSteps, transactionPlan);
    transactionPlan.calculateTaxAndSetOnLineItems();
    calculateAmountsForTransactionSteps(postTaxSteps, transactionPlan);
    transactionPlan.calculateTotalsFromLineItemsAndSteps();

    transactionPlan.steps = transactionPlan.steps.filter(s => s.amount !== 0);
    return transactionPlan;
}

function isValueRedeemable(value: Value): boolean {
    const now = new Date();

    if (value.frozen || !value.active || value.usesRemaining === 0) {
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
                if (step.type === "charge") {
                    calculateAmountForStripeTransactionStep(step as StripeChargeTransactionPlanStep, transactionPlan);
                } else {
                    throw new Error(`Invalid transaction plan step. Expecting type = 'charge' but received ${step.type}.`);
                }
                break;
            case "internal":
                calculateAmountForInternalTransactionStep(step, transactionPlan);
                break;
        }
    }
}

function calculateAmountForLightrailTransactionStep(step: LightrailTransactionPlanStep, transactionPlan: TransactionPlan): void {
    log.info(`calculateAmountForLightrailTransactionStep ${JSON.stringify(step)}.`);

    let value = step.value;
    if (!isValueRedeemable(value)) {
        log.info(`Value ${value.id} CANNOT be redeemed.`);
        return;
    }
    for (const index in transactionPlan.lineItems) {
        const item = transactionPlan.lineItems[index];
        if (item.lineTotal.remainder > 0) {
            if (value.redemptionRule) {
                if (!new RuleContext({
                    totals: transactionPlan.totals,
                    lineItems: transactionPlan.lineItems,
                    currentLineItem: item,
                    metadata: transactionPlan.metadata,
                    value: {
                        balanceChange: step.amount,
                        metadata: step.value.metadata
                    }
                }).evaluateRedemptionRule(value.redemptionRule)) {
                    log.info(`Value ${value.id} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                    continue;
                }
            }

            log.info(`Value ${value.id} CAN be applied to ${JSON.stringify(item)}.`);
            let amount: number;
            if (value.balanceRule) {
                const valueFromRule = new RuleContext({
                    totals: transactionPlan.totals,
                    lineItems: transactionPlan.lineItems,
                    currentLineItem: item,
                    metadata: transactionPlan.metadata,
                    value: {
                        balanceChange: step.amount,
                        metadata: step.value.metadata
                    }
                }).evaluateBalanceRule(value.balanceRule);
                amount = Math.min(item.lineTotal.remainder, bankersRounding(valueFromRule, 0) | 0);
                step.amount -= amount;
            } else {
                amount = Math.min(item.lineTotal.remainder, getAvailableBalance(value.balance, step.amount));
                step.amount -= amount;
            }
            if (value.usesRemaining != null && !step.uses) {
                step.uses = -1;
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

function calculateAmountForStripeTransactionStep(step: StripeChargeTransactionPlanStep, transactionPlan: TransactionPlan): void {
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

    step.amount -= amount;
}

function calculateAmountForInternalTransactionStep(step: InternalTransactionPlanStep, transactionPlan: TransactionPlan): void {
    for (const item of transactionPlan.lineItems) {
        const amount = Math.min(item.lineTotal.remainder, getAvailableBalance(step.balance, step.amount));
        step.amount -= amount;
        item.lineTotal.remainder -= amount;
    }
}

function getAvailableBalance(balance: number, negativeStepAmount: number): number {
    return balance + negativeStepAmount;
}

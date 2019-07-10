import {
    InternalTransactionPlanStep,
    isStepWithAmount,
    LightrailUpdateTransactionPlanStep,
    StripeChargeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "../TransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {Value} from "../../../../model/Value";
import {RuleContext} from "../rules/RuleContext";
import {CheckoutTransactionPlan} from "./CheckoutTransactionPlan";
import {bankersRounding} from "../../../../utils/moneyUtils";
import {LineItemResponse} from "../../../../model/LineItem";
import log = require("loglevel");

/**
 * Build a TransactionPlan for checkout.  This mutates the steps by setting the amount.
 */
export function calculateCheckoutTransactionPlanForOrderedSteps(checkout: CheckoutRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[], now: Date): TransactionPlan {
    // Reset step amounts in case they were set in a previous call to this function.
    for (const step of [...preTaxSteps, ...postTaxSteps]) {
        if (isStepWithAmount(step)) {
            step.amount = 0;
            if ((step as LightrailUpdateTransactionPlanStep).uses != null) {
                (step as LightrailUpdateTransactionPlanStep).uses = 0;
            }
        }
    }

    let transactionPlan = new CheckoutTransactionPlan(checkout, preTaxSteps.concat(postTaxSteps), now);
    log.info(`Build checkout transaction plan: ${JSON.stringify(transactionPlan)}`);
    calculateAmountsForTransactionSteps(preTaxSteps, transactionPlan);
    transactionPlan.calculateTaxAndSetOnLineItems();
    calculateAmountsForTransactionSteps(postTaxSteps, transactionPlan);
    transactionPlan.calculateTotalsFromLineItemsAndSteps();

    transactionPlan.steps = transactionPlan.steps.filter(s => isStepWithAmount(s) && s.amount !== 0);
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
                calculateAmountForLightrailTransactionStep(step as LightrailUpdateTransactionPlanStep, transactionPlan);
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

function calculateAmountForLightrailTransactionStep(step: LightrailUpdateTransactionPlanStep, transactionPlan: TransactionPlan): void {
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
                if (!getRuleContext(transactionPlan, value, step, item).evaluateRedemptionRule(value.redemptionRule)) {
                    log.info(`Value ${value.id} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                    continue;
                }
            }

            log.info(`Value ${value.id} CAN be applied to ${JSON.stringify(item)}.`);
            let amount: number;
            if (value.balanceRule) {
                const evaluateBalanceRule = getRuleContext(transactionPlan, value, step, item).evaluateBalanceRule(value.balanceRule);
                const amountFromRule: number = isNaN(evaluateBalanceRule) || evaluateBalanceRule < 0 ? 0 : evaluateBalanceRule;
                const roundedAmountFromRule = bankersRounding(amountFromRule, 0);
                amount = Math.min(item.lineTotal.remainder, roundedAmountFromRule);
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
    let stepAmount: number = 0;

    for (const item of transactionPlan.lineItems) {
        let stepItemAmount = item.lineTotal.remainder;
        if (step.maxAmount && stepAmount + stepItemAmount > step.maxAmount) {
            stepItemAmount = step.maxAmount - stepAmount;
        }
        stepAmount += stepItemAmount;
        item.lineTotal.remainder -= stepItemAmount;
    }

    step.amount -= stepAmount;
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

function getRuleContext(transactionPlan: TransactionPlan, value: Value, step: LightrailUpdateTransactionPlanStep, item: LineItemResponse): RuleContext {
    return new RuleContext({
        totals: transactionPlan.totals,
        lineItems: transactionPlan.lineItems,
        currentLineItem: item,
        metadata: transactionPlan.metadata,
        value: {
            balanceChange: step.amount,
            metadata: step.value.metadata
        }
    });
}

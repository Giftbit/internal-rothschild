import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {OrderRequest} from "../../../model/TransactionRequest";
import {LineItemResponse} from "../../../model/LineItem";
import {Value} from "../../../model/Value";
import * as bankersRounding from "bankers-rounding";
import {listPermutations} from "../../utils/combinatoricUtils";
import {RuleContext} from "./RuleContext";

// todo - limit of 1 promotion per order rule. rule context needs to be created and decided on
export function buildTransactionPlan(order: OrderRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let bestPlan: TransactionPlan;

    if (preTaxSteps.length > 0 && postTaxSteps.length > 0) {
        console.log("there are perms of each!");
        let preTaxPerms = getStepPermutations(preTaxSteps);
        for (let preTaxPerm of preTaxPerms) {
            let postTaxPerms = getStepPermutations(postTaxSteps);
            for (let postTaxPerm of postTaxPerms) {
                bestPlan = calculateTransactionPlanAndCompareAndReturnBest(order, preTaxPerm, postTaxPerm, bestPlan)
            }
        }
    } else if (preTaxSteps.length > 0 && postTaxSteps.length === 0) {
        console.log("no post steps!");
        let preTaxPerms = getStepPermutations(preTaxSteps);
        for (let preTaxPerm of preTaxPerms) {
            bestPlan = calculateTransactionPlanAndCompareAndReturnBest(order, preTaxPerm, [], bestPlan)
        }
    } else if (preTaxSteps.length === 0 && postTaxSteps.length > 0) {
        console.log("no pre steps!");
        let postTaxPerms = getStepPermutations(postTaxSteps);
        console.log(`\n\npostTaxPerms: ${JSON.stringify(postTaxPerms)}\n\n`);
        for (let postTaxPerm of postTaxPerms) {
            bestPlan = calculateTransactionPlanAndCompareAndReturnBest(order, [], postTaxPerm, bestPlan)
        }
    } else {
        console.log(`No steps!`)
    }

    console.log(`overall best plan = ${JSON.stringify(bestPlan)}\n\n\n\n`);
    return bestPlan;
}

const debug = false;

function calculateTransactionPlanAndCompareAndReturnBest(order: OrderRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[], bestPlan: TransactionPlan): TransactionPlan {
    let newPlan = calculateTransactionPlan(order, preTaxSteps, postTaxSteps);
    console.log(`new plans totals: ${JSON.stringify(newPlan.totals)}`);
    if (!bestPlan || (newPlan.totals.payable < bestPlan.totals.payable)) {
        bestPlan = newPlan;
        console.log(`Found a better perm. ${JSON.stringify(bestPlan)}`);
    } else {
        console.log("old plan was better.")
    }
    return bestPlan
}

export function calculateTransactionPlan(order: OrderRequest, preTaxSteps: TransactionPlanStep[], postTaxSteps: TransactionPlanStep[]): TransactionPlan {
    let transactionPlan = initializeTransactionPlan(order, preTaxSteps.concat(postTaxSteps));
    console.log(`\nbuild order transaction plan:\n${JSON.stringify(transactionPlan)}\n\n`);
    for (let step of preTaxSteps.concat(postTaxSteps)) {
        console.log(JSON.stringify(step));
    }
    processTransactionSteps(preTaxSteps, transactionPlan);
    applyTax(transactionPlan);
    processTransactionSteps(postTaxSteps, transactionPlan);
    calculateTotalsFromLineItems(transactionPlan);
    debug && console.log(`transactionPlan: ${JSON.stringify(transactionPlan)}`);

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
    debug && console.log(`processing ValueStore ${JSON.stringify(step)}.`);
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
            // todo - getRuleFromCache(value.redemptionRule.rule)
            if (!new RuleContext(transactionPlan, item).evaluateRedemptionRule(value.redemptionRule)) {
                console.log(`ValueStore ${JSON.stringify(value)} CANNOT be applied to ${JSON.stringify(item)}. Skipping to next item.`);
                break;
            }
        }

        debug && console.log(`ValueStore ${JSON.stringify(value)} CAN be applied to ${JSON.stringify(item)}.`);
        if (item.lineTotal.remainder > 0) {
            let amount: number;
            if (value.valueRule) {
                amount = Math.min(item.lineTotal.remainder, new RuleContext(transactionPlan, item).evaluateValueRule(value.valueRule) | 0);
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
    // todo - if transacted against, reduce uses. This means that
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

/**
 * This takes out non lightrail steps and always does them last in the permutations.
 * It also preserves the order of the non-lightrail steps.
 * todo - requires more testing if this is a thing we want to do.
 */
export function getStepPermutations(steps: TransactionPlanStep[]): Array<Array<TransactionPlanStep>> {
    const nonLightrailSteps = steps.filter(it => it.rail !== "lightrail");
    const lighrailSteps = steps.filter(it => it.rail === "lightrail");

    let lightrailPerms = listPermutations(lighrailSteps);
    for (let perm of lightrailPerms) {
        for (let nonLightrailStep of nonLightrailSteps) {
            perm.push(nonLightrailStep)
        }
    }
    return lightrailPerms;
}
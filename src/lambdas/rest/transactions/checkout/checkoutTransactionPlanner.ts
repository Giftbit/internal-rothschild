import {calculateCheckoutTransactionPlan} from "./calculateTransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import {listPermutations} from "../../../../utils/combinatoricUtils";
import log = require("loglevel");

export function optimizeCheckout(checkout: CheckoutRequest, steps: TransactionPlanStep[]): TransactionPlan {
    let bestPlan: TransactionPlan = null;

    log.info(`Getting checkout permutations.`);
    const permutations = getAllPermutations(steps);

    for (const perm of permutations) {
        log.info(`Calculating transaction plan for permutation: ${JSON.stringify(perm)}.`);
        let newPlan = calculateCheckoutTransactionPlan(checkout, perm.preTaxSteps, perm.postTaxSteps);
        log.info(`Calculated new transaction plan: ${JSON.stringify(newPlan)}.`);
        if (!bestPlan || (newPlan.totals.payable < bestPlan.totals.payable)) {
            bestPlan = newPlan;
            log.info(`Found a better transaction plan: ${JSON.stringify(bestPlan)}`);
        } else {
            log.info(`Old bestPlan's payable ${bestPlan.totals.payable} < new plan's payable ${newPlan.totals.payable}.`);
        }
    }

    if (!bestPlan) {
        log.info("No steps provided.");
        bestPlan = calculateCheckoutTransactionPlan(checkout, [], []);
    }

    log.info(`Overall best plan: ${JSON.stringify(bestPlan)}`);
    return bestPlan;
}

export interface StepPermutation {
    preTaxSteps: TransactionPlanStep[];
    postTaxSteps: TransactionPlanStep[];
}

export function* getAllPermutations(steps: TransactionPlanStep[]): IterableIterator<StepPermutation> {
    const [preTaxSteps, postTaxSteps] = dualFilter(steps, step => (step.rail === "internal" && step.pretax) || (step.rail === "lightrail" && step.value.pretax));

    if (preTaxSteps.length > 0 && postTaxSteps.length > 0) {
        const preTaxPerms = getStepPermutations(preTaxSteps);
        for (const preTaxPerm of preTaxPerms) {
            const postTaxPerms = getStepPermutations(postTaxSteps);
            for (const postTaxPerm of postTaxPerms) {
                yield {
                    preTaxSteps: JSON.parse(JSON.stringify(preTaxPerm)) /* this is subtle, need to be clones, otherwise object gets modified */,
                    postTaxSteps: JSON.parse(JSON.stringify(postTaxPerm))
                };
            }
        }
    } else if (preTaxSteps.length > 0 && postTaxSteps.length === 0) {
        const preTaxPerms = getStepPermutations(preTaxSteps);
        for (const preTaxPerm of preTaxPerms) {
            yield {preTaxSteps: JSON.parse(JSON.stringify(preTaxPerm)), postTaxSteps: []};
        }
    } else if (preTaxSteps.length === 0 && postTaxSteps.length > 0) {
        const postTaxPerms = getStepPermutations(postTaxSteps);
        for (const postTaxPerm of postTaxPerms) {
            yield {preTaxSteps: [], postTaxSteps: JSON.parse(JSON.stringify(postTaxPerm))};
        }
    } else {
        log.info("No steps were supplied.");
    }
    return;
}

/**
 * IDEA: turn this into a generator function to save on memory usage.  That
 *       only works if listPermutations is also a generator.
 */
export function getStepPermutations(steps: TransactionPlanStep[]): TransactionPlanStep[][] {
    let filteredSteps = filterSteps(steps);
    let lightrailPerms: TransactionPlanStep[][] = listPermutations(filteredSteps.lightrailSteps).map(perm => flattenOneLevel(perm));

    return lightrailPerms.map(perm => [...filteredSteps.stepsBeforeLightrail, ...perm, ...filteredSteps.stepsAfterLightrail]);
}

export function filterSteps(steps: TransactionPlanStep[]): FilteredSteps {
    return {
        stepsBeforeLightrail: steps.filter(step => step.rail === "internal" && step.beforeLightrail),
        stepsAfterLightrail: steps.filter(step => step.rail !== "lightrail" && !step["beforeLightrail"]),
        lightrailSteps: batchEquivalentLightrailSteps(steps.filter(step => step.rail === "lightrail") as LightrailTransactionPlanStep[]),
    };
}

/**
 * Group Lightrail steps that reordering could not change the payable total for.
 * When the return value is permutated and then flattened one layer you get all
 * permutations with the grouped steps still together.
 */
function batchEquivalentLightrailSteps(lightrailSteps: LightrailTransactionPlanStep[]): (LightrailTransactionPlanStep | LightrailTransactionPlanStep[])[] {
    let [lightrailSimpleSteps, lightrailComplexSteps] = dualFilter(lightrailSteps, step => !step.value.valueRule && !step.value.redemptionRule);
    lightrailSimpleSteps.sort((a, b) => {
        // Prefer soonest expiration, then any expiration, then discounts then lowest balance
        if (a.value.endDate && b.value.endDate) {
            return (b.value.endDate as any) - (a.value.endDate as any); // subtracting Dates really does work
        } else if (a.value.endDate) {
            return -1;
        } else if (b.value.endDate) {
            return 1;
        } else if (a.value.discount !== b.value.discount) {
            return +b.value.discount - +a.value.discount;
        }
        return a.value.balance - b.value.balance;
    });
    return [lightrailSimpleSteps, ...lightrailComplexSteps];
}

interface FilteredSteps {
    stepsBeforeLightrail: TransactionPlanStep[];
    stepsAfterLightrail: TransactionPlanStep[];
    lightrailSteps: (LightrailTransactionPlanStep | LightrailTransactionPlanStep[])[];
}

/**
 * Get an array of elements that pass the filter and another of elements that don't
 * pass the filter.  All items are in one of the two arrays exactly once.
 */
function dualFilter<T>(steps: T[], filter: (step: T) => boolean): [T[], T[]] {
    return [
        steps.filter(filter),
        steps.filter(step => !filter(step))
    ];
}

function flattenOneLevel<T>(arr: (T | T[])[]): T[] {
    const res: T[] = [];
    for (const element of arr) {
        if (Array.isArray(element)) {
            res.push(...element);
        } else {
            res.push(element);
        }
    }
    return res;
}

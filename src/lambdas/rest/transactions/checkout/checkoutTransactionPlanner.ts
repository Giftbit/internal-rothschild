import {calculateCheckoutTransactionPlan} from "./calculateTransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
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

// Todo - Trying all permutations of things that represent discounts + valueRules makes sense but gift cards, accounts etc should maybe be ordered by expiry or order passed in?
// Todo - ie, a customer at checkout wants to use up a gift card and then charge the rest onto their account.
// Todo - This can probably wait because it's not very likely to happen immediately.
export function* getAllPermutations(steps: TransactionPlanStep[]): IterableIterator<StepPermutation> {
    const preTaxSteps: TransactionPlanStep[] = steps.filter(it => (it.rail === "internal" && it.pretax) || (it.rail === "lightrail" && it.value.pretax));
    const postTaxSteps: TransactionPlanStep[] = steps.filter(x => preTaxSteps.indexOf(x) < 0);

    if (preTaxSteps.length > 0 && postTaxSteps.length > 0) {
        let preTaxPerms = getStepPermutations(preTaxSteps);
        for (let preTaxPerm of preTaxPerms) {
            let postTaxPerms = getStepPermutations(postTaxSteps);
            for (let postTaxPerm of postTaxPerms) {
                yield {
                    preTaxSteps: JSON.parse(JSON.stringify(preTaxPerm)) /* this is subtle, need to be clones, otherwise object gets modified */,
                    postTaxSteps: postTaxPerm
                };
            }
        }
    } else if (preTaxSteps.length > 0 && postTaxSteps.length === 0) {
        let preTaxPerms = getStepPermutations(preTaxSteps);
        for (let preTaxPerm of preTaxPerms) {
            yield {preTaxSteps: preTaxPerm, postTaxSteps: []};
        }
    } else if (preTaxSteps.length === 0 && postTaxSteps.length > 0) {
        let postTaxPerms = getStepPermutations(postTaxSteps);
        for (let postTaxPerm of postTaxPerms) {
            yield {preTaxSteps: [], postTaxSteps: postTaxPerm};
        }
    } else {
        log.info("No steps were supplied.");
    }
    return;
}

export function getStepPermutations(steps: TransactionPlanStep[]): TransactionPlanStep[][] {
    let filteredSteps = filterSteps(steps);
    let lightrailPerms: TransactionPlanStep[][] = listPermutations(filteredSteps.lighrailSteps);

    return lightrailPerms.map(perm => [...filteredSteps.stepsBeforeLightrail, ...perm, ...filteredSteps.stepsAfterLightrail]);
}

export function filterSteps(steps: TransactionPlanStep[]): FilteredSteps {
    return {
        stepsBeforeLightrail: steps.filter(step => step.rail === "internal" && step.beforeLightrail),
        stepsAfterLightrail: steps.filter(step => step.rail !== "lightrail" && !step["beforeLightrail"]),
        lighrailSteps: steps.filter(step => step.rail === "lightrail"),
    };
}

interface FilteredSteps {
    stepsBeforeLightrail: TransactionPlanStep[];
    stepsAfterLightrail: TransactionPlanStep[];
    lighrailSteps: TransactionPlanStep[];
}

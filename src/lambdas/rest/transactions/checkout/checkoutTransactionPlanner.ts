import {calculateCheckoutTransactionPlan} from "./calculateTransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import {listPermutations} from "../../../utils/combinatoricUtils";

export function optimizeCheckout(checkout: CheckoutRequest, steps: TransactionPlanStep[]): TransactionPlan {
    let bestPlan: TransactionPlan = null;
    const permutations = getAllPermutations(steps);
    if (permutations.length > 0) {
        for (const perm of permutations) {
            console.log(`Calculating transaction plan for permutation: ${JSON.stringify(perm)}.`);
            let newPlan = calculateCheckoutTransactionPlan(checkout, perm.preTaxSteps, perm.postTaxSteps);
            console.log(`Calculated new transaction plan: ${JSON.stringify(newPlan)}.`);
            if (!bestPlan || (newPlan.totals.payable < bestPlan.totals.payable)) {
                bestPlan = newPlan;
                console.log(`Found a better transaction plan: ${JSON.stringify(bestPlan)}`);
            } else {
                console.log(`Old bestPlan's payable ${bestPlan.totals.payable} < new plan's payable ${newPlan.totals.payable}.`);
            }
        }
    } else {
        console.log("No steps provided.");
        bestPlan = calculateCheckoutTransactionPlan(checkout, [], []);
    }

    console.log(`Overall best plan: ${JSON.stringify(bestPlan)}`);
    return bestPlan;
}

export interface StepPermutation {
    preTaxSteps: TransactionPlanStep[];
    postTaxSteps: TransactionPlanStep[];
}

// Todo - Trying all permutations of things that represent discounts + valueRules makes sense but gift cards, accounts etc should maybe be ordered by expiry or order passed in?
// Todo - ie, a customer at checkout wants to use up a gift card and then charge the rest onto their account.
// Todo - This can probably wait because it's not very likely to happen immediately.
export function getAllPermutations(steps: TransactionPlanStep[]): StepPermutation[] {
    const preTaxSteps: TransactionPlanStep[] = steps.filter(it => (it.rail === "internal" && it.pretax) || (it.rail === "lightrail" && it.value.pretax));
    const postTaxSteps: TransactionPlanStep[] = steps.filter(x => preTaxSteps.indexOf(x) < 0);

    let stepPermutations: StepPermutation[] = [];

    if (preTaxSteps.length > 0 && postTaxSteps.length > 0) {
        let preTaxPerms = getStepPermutations(preTaxSteps);
        for (let preTaxPerm of preTaxPerms) {
            let postTaxPerms = getStepPermutations(postTaxSteps);
            for (let postTaxPerm of postTaxPerms) {
                stepPermutations.push({
                    preTaxSteps: JSON.parse(JSON.stringify(preTaxPerm)) /* this is subtle, need to be clones, otherwise object gets modified */,
                    postTaxSteps: postTaxPerm
                });
            }
        }
    } else if (preTaxSteps.length > 0 && postTaxSteps.length === 0) {
        let preTaxPerms = getStepPermutations(preTaxSteps);
        for (let preTaxPerm of preTaxPerms) {
            stepPermutations.push({preTaxSteps: preTaxPerm, postTaxSteps: []});
        }
    } else if (preTaxSteps.length === 0 && postTaxSteps.length > 0) {
        let postTaxPerms = getStepPermutations(postTaxSteps);
        for (let postTaxPerm of postTaxPerms) {
            stepPermutations.push({preTaxSteps: [], postTaxSteps: postTaxPerm});
        }
    } else {
        console.log("No steps were supplied.");
    }
    return stepPermutations;
}

export function getStepPermutations(steps: TransactionPlanStep[]): Array<Array<TransactionPlanStep>> {
    let filteredSteps = filterSteps(steps);
    let lightrailPerms = listPermutations(filteredSteps.lighrailSteps);

    let result: Array<Array<TransactionPlanStep>> = [];
    for (let perm of lightrailPerms) {
        result.push(filteredSteps.stepsBeforeLightrail.concat(perm).concat(filteredSteps.stepsAfterLightrail));
    }
    return result;
}

export function filterSteps(steps: TransactionPlanStep[]): FilteredSteps {
    return {
        stepsBeforeLightrail: steps.filter(it => it.rail === "internal" && it.beforeLightrail),
        stepsAfterLightrail: steps.filter(it => it.rail !== "lightrail" && !it["beforeLightrail"]),
        lighrailSteps: steps.filter(it => it.rail === "lightrail"),
    };
}

interface FilteredSteps {
    stepsBeforeLightrail: TransactionPlanStep[];
    stepsAfterLightrail: TransactionPlanStep[];
    lighrailSteps: TransactionPlanStep[];
}
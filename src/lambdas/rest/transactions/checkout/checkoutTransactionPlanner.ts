import {calculateCheckoutTransactionPlan} from "./calculateCheckoutTransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import log = require("loglevel");

export function optimizeCheckout(checkout: CheckoutRequest, steps: TransactionPlanStep[]): TransactionPlan {
    log.info(`optimizing checkout transaction`);

    const unsortedPretaxSteps = steps.filter(step => (step.rail === "internal" && step.pretax) || (step.rail === "lightrail" && step.value.pretax));
    const unsortedPostTaxSteps = steps.filter(step => unsortedPretaxSteps.indexOf(step) === -1);

    const sortedPretaxSteps = [];
    const sortedPostTaxSteps = [];

    optimizeSteps(true, unsortedPretaxSteps, checkout, sortedPretaxSteps, sortedPostTaxSteps);
    optimizeSteps(false, unsortedPostTaxSteps, checkout, sortedPretaxSteps, sortedPostTaxSteps);

    log.info(`optimized checkout transaction\nsortedPretaxSteps: ${JSON.stringify(sortedPretaxSteps)}\nsortedPostTaxSteps: ${JSON.stringify(sortedPostTaxSteps)}`);

    return calculateCheckoutTransactionPlan(checkout, sortedPretaxSteps, sortedPostTaxSteps);
}

/**
 * Sort the given unsorted steps and append them to pretax or postTax steps.
 */
function optimizeSteps(pretax: boolean, unsortedSteps: TransactionPlanStep[], checkout: CheckoutRequest, sortedPretaxSteps: TransactionPlanStep[], sortedPostTaxSteps: TransactionPlanStep[]): void {
    log.info(`optimizing ${unsortedSteps.length} ${pretax ? "pretax" : "postTax"} steps`);

    const splitUnsortedSteps = splitNonLightrailSteps(unsortedSteps);
    (pretax ? sortedPretaxSteps : sortedPostTaxSteps).push(...splitUnsortedSteps.stepsBeforeLightrail);

    for (const lightrailStepBucket of bucketLightrailSteps(splitUnsortedSteps.lightrailSteps)) {
        log.info(`ordering bucket with ${lightrailStepBucket.length} lightrail steps:`, lightrailStepBucket.map(step => step.value.id));
        while (lightrailStepBucket.length) {
            if (lightrailStepBucket.length === 1) {
                log.info("only 1 step, easy");
                (pretax ? sortedPretaxSteps : sortedPostTaxSteps).push(lightrailStepBucket[0]);
                break;
            }

            // Find the next step that reduces the payable the most and use that.
            let bestPlan: TransactionPlan = null;
            let bestStepIx = -1;
            for (let stepIx = 0; stepIx < lightrailStepBucket.length; stepIx++) {
                const step = lightrailStepBucket[stepIx];
                const newPlanPretaxSteps = pretax ? [...sortedPretaxSteps, step] : sortedPretaxSteps;
                const newPlanPostTaxSteps = pretax ? sortedPostTaxSteps : [...sortedPostTaxSteps, step];
                const newPlan = calculateCheckoutTransactionPlan(checkout, newPlanPretaxSteps, newPlanPostTaxSteps);

                log.info(`step ${step.value.id} has payable ${newPlan.totals.payable}`);
                if (!bestPlan || (newPlan.totals.payable < bestPlan.totals.payable)) {
                    bestPlan = newPlan;
                    bestStepIx = stepIx;
                }
            }

            log.info(`step ${lightrailStepBucket[bestStepIx].value.id} has the lowest payable`);
            (pretax ? sortedPretaxSteps : sortedPostTaxSteps).push(lightrailStepBucket.splice(bestStepIx, 1)[0]);
        }
    }

    (pretax ? sortedPretaxSteps : sortedPostTaxSteps).push(...splitUnsortedSteps.stepsAfterLightrail);
}

function splitNonLightrailSteps(steps: TransactionPlanStep[]) {
    return {
        stepsBeforeLightrail: steps.filter(step => step.rail === "internal" && step.beforeLightrail),
        stepsAfterLightrail: steps.filter(step => step.rail !== "lightrail" && !step["beforeLightrail"]),
        lightrailSteps: steps.filter(step => step.rail === "lightrail") as LightrailTransactionPlanStep[],
    };
}

/**
 * Bucket steps into groups such that buckets are in the correct order but
 * steps within the bucket might not be in the correct order.
 *
 * For example if the result is `[a, b],[c, d],[e]` then `a` and `b` should
 * come before `c` and `d`, but it's not yet known if `a` or `b` should be first.
 */
function bucketLightrailSteps(steps: LightrailTransactionPlanStep[]): LightrailTransactionPlanStep[][] {
    log.info("bucketing lightrail steps:", steps.map(step => step.value.id));

    const bucketedSteps = steps
        .concat()
        .sort(lightrailTransactionPlanStepComparer)     // Sorts in place, thus the concat() above.
        .reduce((bucketedArray: LightrailTransactionPlanStep[][], currentStep: LightrailTransactionPlanStep) => {
            // Put steps that sort to the same place in a bucket so they can be sorted another way.
            if (bucketedArray.length === 0) {
                log.info(`step ${currentStep.value.id} is the first step`);
                bucketedArray.push([currentStep]);
                return bucketedArray;
            }

            const lastBucket = bucketedArray[bucketedArray.length - 1];
            const lastBucketedStep = lastBucket[lastBucket.length - 1];
            const belongsInSameBucket = lightrailTransactionPlanStepComparer(lastBucketedStep, currentStep) === 0;

            if (belongsInSameBucket) {
                log.info(`step ${currentStep.value.id} belongs in the same bucket`);
                lastBucket.push(currentStep);
            } else {
                log.info(`step ${currentStep.value.id} belongs in a new bucket`);
                bucketedArray.push([currentStep]);
            }

            return bucketedArray;
        }, []);

    log.info("bucketed lightrail steps:", bucketedSteps.map(b => b.map(step => step.value.id)));
    return bucketedSteps;
}

/**
 * Compare LightrailTransactionPlanSteps so that earlier values are used first.
 */
function lightrailTransactionPlanStepComparer(a: LightrailTransactionPlanStep, b: LightrailTransactionPlanStep): number {
    if (a.value.discount !== b.value.discount) {
        // Discounts before not discounts.
        return a.value.discount ? -1 : 1;
    }
    if (a.value.endDate && b.value.endDate) {
        // Earlier expiration before later expiration.
        let dateDifference = (a.value.endDate as any) - (b.value.endDate as any); // subtracting Dates really does work
        if (dateDifference !== 0) {
            return dateDifference;
        }
    } else if (!a.value.endDate !== !b.value.endDate) {
        // Any expiration before no expiration.
        return a.value.endDate ? -1 : 1;
    }
    if (!a.value.redemptionRule !== !b.value.redemptionRule) {
        // No redemption rule before redemption rule.
        return a.value.redemptionRule ? 1 : -1;
    }
    if (!a.value.redemptionRule && !b.value.redemptionRule
        && !a.value.balanceRule && !b.value.balanceRule) {
        // For plain values without rules, empty the smaller balance first.
        return a.value.balance - b.value.balance;
    }
    return 0;
}

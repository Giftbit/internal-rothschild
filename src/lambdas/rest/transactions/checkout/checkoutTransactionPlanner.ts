import {calculateCheckoutTransactionPlan} from "./calculateCheckoutTransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import log = require("loglevel");

export function optimizeCheckout(checkout: CheckoutRequest, steps: TransactionPlanStep[]): TransactionPlan {
    log.info(`optimizing checkout transaction`);

    const unsortedPretaxSteps = steps.filter(step => (step.rail === "internal" && step.pretax) || (step.rail === "lightrail" && step.value.pretax));
    const unsortedPostTaxSteps = steps.filter(step => unsortedPretaxSteps.indexOf(step) === -1);

    const sortedPretaxSteps = optimizePretaxSteps(checkout, unsortedPretaxSteps);
    const sortedPostTaxSteps = optimizePostTaxSteps(checkout, sortedPretaxSteps, unsortedPostTaxSteps);

    log.info(`optimized checkout transaction\nsortedPretaxSteps: ${JSON.stringify(sortedPretaxSteps)}\nsortedPostTaxSteps: ${JSON.stringify(sortedPostTaxSteps)}`);

    return calculateCheckoutTransactionPlan(checkout, sortedPretaxSteps, sortedPostTaxSteps);
}

function optimizePretaxSteps(checkout: CheckoutRequest, unsortedPretaxSteps: TransactionPlanStep[]): TransactionPlanStep[] {
    log.info(`optimizing ${unsortedPretaxSteps.length} unsortedPretaxSteps: ${JSON.stringify(unsortedPretaxSteps)}`);

    const splitUnsortedSteps = splitNonLightrailSteps(unsortedPretaxSteps);
    const sortedPretaxSteps = [...splitUnsortedSteps.stepsBeforeLightrail];

    for (const lightrailStepBucket of bucketLightrailSteps(splitUnsortedSteps.lightrailSteps)) {
        log.info(`ordering bucket with ${lightrailStepBucket.length} lightrail steps ${JSON.stringify(lightrailStepBucket.map(b => b.value.id))}`);
        while (lightrailStepBucket.length) {
            if (lightrailStepBucket.length === 1) {
                log.info("only 1 step, easy");
                sortedPretaxSteps.push(lightrailStepBucket[0]);
                break;
            }

            let bestPlan: TransactionPlan = null;
            let bestStepIx = -1;
            for (let stepIx = 0; stepIx < lightrailStepBucket.length; stepIx++) {
                const step = lightrailStepBucket[stepIx];
                const newPlan = calculateCheckoutTransactionPlan(checkout, [...sortedPretaxSteps, step], []);

                log.info(`step ${step.value.id} has payable ${newPlan.totals.payable}`);
                if (!bestPlan || (newPlan.totals.payable < bestPlan.totals.payable)) {
                    bestPlan = newPlan;
                    bestStepIx = stepIx;
                }
            }

            log.info(`step ${lightrailStepBucket[bestStepIx].value.id} has the lowest payable`);
            sortedPretaxSteps.push(lightrailStepBucket.splice(bestStepIx, 1)[0]);
        }
    }

    sortedPretaxSteps.push(...splitUnsortedSteps.stepsAfterLightrail);
    return sortedPretaxSteps;
}

function optimizePostTaxSteps(checkout: CheckoutRequest, sortedPreTaxSteps: TransactionPlanStep[], unsortedPostTaxSteps: TransactionPlanStep[]): TransactionPlanStep[] {
    log.info(`optimizing ${unsortedPostTaxSteps.length} unsortedPostTaxSteps: ${JSON.stringify(unsortedPostTaxSteps)}`);

    const splitUnsortedSteps = splitNonLightrailSteps(unsortedPostTaxSteps);
    const sortedPostTaxSteps = [...splitUnsortedSteps.stepsBeforeLightrail];

    for (const lightrailStepBucket of bucketLightrailSteps(splitUnsortedSteps.lightrailSteps)) {
        log.info(`ordering bucket with ${lightrailStepBucket.length} lightrail steps ${JSON.stringify(lightrailStepBucket.map(b => b.value.id))}`);
        while (lightrailStepBucket.length) {
            if (lightrailStepBucket.length === 1) {
                log.info("only 1 step, easy");
                sortedPostTaxSteps.push(lightrailStepBucket[0]);
                break;
            }

            let bestPlan: TransactionPlan = null;
            let bestStepIx = -1;
            for (let stepIx = 0; stepIx < lightrailStepBucket.length; stepIx++) {
                const step = lightrailStepBucket[stepIx];
                const newPlan = calculateCheckoutTransactionPlan(checkout, sortedPreTaxSteps, [...sortedPostTaxSteps, step]);

                log.info(`step ${step.value.id} has payable ${newPlan.totals.payable}`);
                if (!bestPlan || (newPlan.totals.payable < bestPlan.totals.payable)) {
                    bestPlan = newPlan;
                    bestStepIx = stepIx;
                }
            }

            log.info(`step ${lightrailStepBucket[bestStepIx].value.id} has the lowest payable`);
            sortedPostTaxSteps.push(lightrailStepBucket.splice(bestStepIx, 1)[0]);
        }
    }

    sortedPostTaxSteps.push(...splitUnsortedSteps.stepsAfterLightrail);
    return sortedPostTaxSteps;
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
    log.info(`bucketing lightrail steps ${JSON.stringify(steps)}`);

    return steps
        .concat()
        .sort(lightrailTransactionPlanStepComparer)
        .reduce((bucketedArray: LightrailTransactionPlanStep[][], currentStep: LightrailTransactionPlanStep) => {
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

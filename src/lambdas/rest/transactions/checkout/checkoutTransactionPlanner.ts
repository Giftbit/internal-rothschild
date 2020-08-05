import {calculateCheckoutTransactionPlanForOrderedSteps} from "./calculateCheckoutTransactionPlan";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import {nowInDbPrecision} from "../../../../utils/dbUtils";
import log = require("loglevel");
import {TagOnResource} from "../../../../model/Tag";

export function getCheckoutTransactionPlan(checkout: CheckoutRequest, steps: TransactionPlanStep[], tags: TagOnResource[]): TransactionPlan {
    log.info(`optimizing checkout transaction`);

    const now = nowInDbPrecision();
    const unsortedPretaxSteps = steps.filter(step => (step.rail === "internal" && step.pretax) || (step.rail === "lightrail" && step.value.pretax));
    const unsortedPostTaxSteps = steps.filter(step => unsortedPretaxSteps.indexOf(step) === -1);
    const sortedPretaxSteps = [];
    const sortedPostTaxSteps = [];

    optimizeSteps(true, unsortedPretaxSteps, checkout, sortedPretaxSteps, sortedPostTaxSteps, now);
    optimizeSteps(false, unsortedPostTaxSteps, checkout, sortedPretaxSteps, sortedPostTaxSteps, now);

    log.info(`optimized checkout transaction\nsortedPretaxSteps: ${JSON.stringify(sortedPretaxSteps)}\nsortedPostTaxSteps: ${JSON.stringify(sortedPostTaxSteps)}`);

    const plan = calculateCheckoutTransactionPlanForOrderedSteps(checkout, sortedPretaxSteps, sortedPostTaxSteps, now);
    if (tags && tags.length) {
        plan.tags = tags;
    }
    return plan;
}

/**
 * Sort the given unsorted steps and append them to pretax or postTax steps.
 */
function optimizeSteps(pretax: boolean, unsortedSteps: TransactionPlanStep[], checkout: CheckoutRequest, sortedPretaxSteps: TransactionPlanStep[], sortedPostTaxSteps: TransactionPlanStep[], now: Date): void {
    log.info(`optimizing ${unsortedSteps.length} ${pretax ? "pretax" : "postTax"} steps`);

    const splitUnsortedSteps = splitNonLightrailSteps(unsortedSteps);
    (pretax ? sortedPretaxSteps : sortedPostTaxSteps).push(...splitUnsortedSteps.internalBeforeLightrailSteps);

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
                const newPlan = calculateCheckoutTransactionPlanForOrderedSteps(checkout, newPlanPretaxSteps, newPlanPostTaxSteps, now);

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

    (pretax ? sortedPretaxSteps : sortedPostTaxSteps).push(...splitUnsortedSteps.internalAfterLightrailSteps, ...splitUnsortedSteps.stripeSteps);
}

// Often not ideal but we'll let it slide here.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function splitNonLightrailSteps(steps: TransactionPlanStep[]) {
    return {
        internalBeforeLightrailSteps: steps.filter(step => step.rail === "internal" && step.beforeLightrail),
        internalAfterLightrailSteps: steps.filter(step => step.rail === "internal" && !step["beforeLightrail"]),
        stripeSteps: steps.filter(step => step.rail === "stripe"),
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
        const dateDifference = (a.value.endDate as any) - (b.value.endDate as any); // subtracting Dates really does work
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

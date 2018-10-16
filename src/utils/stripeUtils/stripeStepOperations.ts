import {
    StripeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "../../lambdas/rest/transactions/TransactionPlan";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {createRefund, createStripeCharge} from "./stripeTransactions";
import {LightrailAndMerchantStripeConfig} from "./StripeConfig";
import {StripeRestError} from "./StripeRestError";
import {TransactionPlanError} from "../../lambdas/rest/transactions/TransactionPlanError";
import {StripeCreateChargeParams} from "./StripeCreateChargeParams";
import {PaymentSourceForStripeMetadata, StripeSourceForStripeMetadata} from "./PaymentSourceForStripeMetadata";
import log = require("loglevel");
import {AdditionalStripeChargeParams} from "../../model/TransactionRequest";

export async function chargeStripeSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, stripeConfig: LightrailAndMerchantStripeConfig, plan: TransactionPlan): Promise<void> {
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];

    try {
        for (let step of stripeSteps) {
            const stepForStripe = stripeTransactionPlanStepToStripeRequest(auth, step, plan);

            const charge = await createStripeCharge(stepForStripe, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, step.idempotentStepId);

            // Update transaction plan with charge details
            step.chargeResult = charge;
        }
    } catch (err) {
        if ((err as StripeRestError).additionalParams && (err as StripeRestError).additionalParams.stripeError) {
            throw err;
        } else {
            throw new TransactionPlanError(`Transaction execution canceled because there was a problem charging Stripe: ${err}`, {
                isReplanable: false
            });
        }
    }
}

function stripeTransactionPlanStepToStripeRequest(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeTransactionPlanStep, plan: TransactionPlan): StripeCreateChargeParams {
    let stepForStripe: StripeCreateChargeParams = {
        amount: -step.amount /* Lightrail treats debits as negative amounts on Steps but Stripe requires a positive amount when charging a credit card. */,
        currency: plan.currency,
        metadata: {
            ...plan.metadata,
            lightrailTransactionId: plan.id,
            lightrailTransactionSources: JSON.stringify(
                plan.steps.filter(src => !isCurrentStripeStep(src, step))
                    .map(src => condensePaymentSourceForStripeMetadata(src))
            ),
            lightrailUserId: auth.userId
        }
    };
    if (step.source) {
        stepForStripe.source = step.source;
    }
    if (step.customer) {
        stepForStripe.customer = step.customer;
    }
    if (step.additionalStripeParams) {
        // Only copy these keys on to the charge request.  We don't want to accidentally
        // expose some kind of attack vector.
        const paramKeys: (keyof AdditionalStripeChargeParams)[] = [
            "description",
            "on_behalf_of",
            "receipt_email",
            "statement_descriptor",
            "transfer_group"
        ];
        for (const key of paramKeys) {
            if (step.additionalStripeParams[key]) {
                stepForStripe[key] = step.additionalStripeParams[key];
            }
        }
    }

    log.debug("Created stepForStripe: \n" + JSON.stringify(stepForStripe, null, 4));
    return stepForStripe;
}

export async function rollbackStripeSteps(lightrailStripeSecretKey: string, merchantStripeAccountId: string, steps: StripeTransactionPlanStep[], reason: string): Promise<void> {
    try {
        for (const step of steps) {
            const refund = await createRefund(step, lightrailStripeSecretKey, merchantStripeAccountId, reason);
            log.info(`Refunded Stripe charge ${step.chargeResult.id}. Refund: ${JSON.stringify(refund)}.`);
        }
    } catch (err) {
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

function condensePaymentSourceForStripeMetadata(step: TransactionPlanStep): PaymentSourceForStripeMetadata {
    switch (step.rail) {
        case "lightrail":
            return {
                rail: "lightrail",
                valueId: step.value.id
            };
        case "internal":
            return {
                rail: "internal",
                internalId: step.internalId
            };
        case "stripe":
            let stripeStep = {rail: "stripe"};
            if (step.source) {
                (stripeStep as any).source = step.source;
            }
            if (step.customer) {
                (stripeStep as any).customer = step.customer;
            }
            return stripeStep as StripeSourceForStripeMetadata;
    }
}

function isCurrentStripeStep(step: TransactionPlanStep, currentStep: StripeTransactionPlanStep): boolean {
    return step.rail === "stripe" && step.idempotentStepId === currentStep.idempotentStepId;
}

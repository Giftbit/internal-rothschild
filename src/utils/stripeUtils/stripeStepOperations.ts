import {
    StripeChargeTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "../../lambdas/rest/transactions/TransactionPlan";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {createCharge, createRefund} from "./stripeTransactions";
import {LightrailAndMerchantStripeConfig} from "./StripeConfig";
import {StripeCreateChargeParams} from "./StripeCreateChargeParams";
import {PaymentSourceForStripeMetadata, StripeSourceForStripeMetadata} from "./PaymentSourceForStripeMetadata";
import {StripeCreateRefundParams} from "./StripeCreateRefundParams";
import {StripeRestError} from "./StripeRestError";
import {TransactionPlanError} from "../../lambdas/rest/transactions/TransactionPlanError";
import log = require("loglevel");

export async function processStripeSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, stripeConfig: LightrailAndMerchantStripeConfig, plan: TransactionPlan): Promise<void> {
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];
    try {
        for (let step of stripeSteps) {
            if (step.type === "charge") {
                const stepForStripe = stripeTransactionPlanStepToStripeChargeRequest(auth, step, plan);
                step.chargeResult = await createCharge(stepForStripe, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, step.idempotentStepId);
            } else {
                let stepForStripe: StripeCreateRefundParams = {
                    amount: step.amount,
                    chargeId: step.chargeId
                };
                step.refundResult = await createRefund(stepForStripe, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id);
            }
        }
    } catch (err) {
        if ((err as StripeRestError).additionalParams && (err as StripeRestError).additionalParams.stripeError) {
            // Error was returned from Stripe. Passing original error along so that details of Stripe failure can be returned.
            throw err;
        } else {
            throw new TransactionPlanError(`Transaction execution canceled because there was a problem charging Stripe: ${err}`, {
                isReplanable: false
            });
        }
    }
}

function stripeTransactionPlanStepToStripeChargeRequest(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeChargeTransactionPlanStep, plan: TransactionPlan): StripeCreateChargeParams {
    let stepForStripe: StripeCreateChargeParams = {
        amount: -step.amount /* Lightrail treats debits as negative amounts on Steps but Stripe requires a positive amount when charging a credit card. */,
        currency: plan.currency,
        metadata: {
            ...plan.metadata,
            lightrailTransactionId: plan.id,
            lightrailTransactionSources: JSON.stringify(plan.steps
                .filter(src => !isCurrentStripeStep(src, step))
                .map(src => condensePaymentSourceForStripeMetadata(src))),
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
        if (step.additionalStripeParams.on_behalf_of) {
            stepForStripe.on_behalf_of = step.additionalStripeParams.on_behalf_of;
        }
        if (step.additionalStripeParams.receipt_email) {
            stepForStripe.receipt_email = step.additionalStripeParams.receipt_email;
        }
        if (step.additionalStripeParams.statement_descriptor) {
            stepForStripe.statement_descriptor = step.additionalStripeParams.statement_descriptor;
        }
        if (step.additionalStripeParams.transfer_group) {
            stepForStripe.transfer_group = step.additionalStripeParams.transfer_group;
        }
    }

    log.debug("Created stepForStripe: \n" + JSON.stringify(stepForStripe, null, 4));
    return stepForStripe;
}

export async function rollbackStripeChargeSteps(lightrailStripeSecretKey: string, merchantStripeAccountId: string, steps: StripeChargeTransactionPlanStep[], reason: string): Promise<void> {
    try {
        for (const step of steps) {
            const refundParams: StripeCreateRefundParams = {
                chargeId: step.chargeResult.id,
                amount: step.chargeResult.amount,
                reason: reason
            };
            const refund = await createRefund(refundParams, lightrailStripeSecretKey, merchantStripeAccountId);
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
            if (step.type === "charge") {
                if (step.source) {
                    (stripeStep as any).source = step.source;
                }
                if (step.customer) {
                    (stripeStep as any).customer = step.customer;
                }
                return stripeStep as StripeSourceForStripeMetadata;
            }

    }
}

function isCurrentStripeStep(step: TransactionPlanStep, currentStep: StripeTransactionPlanStep): boolean {
    return step.rail === "stripe" && step.idempotentStepId === currentStep.idempotentStepId;
}

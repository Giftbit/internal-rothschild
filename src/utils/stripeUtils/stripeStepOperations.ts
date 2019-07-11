import {
    StripeChargeTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan,
} from "../../lambdas/rest/transactions/TransactionPlan";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {captureCharge, createCharge, createRefund, updateCharge} from "./stripeTransactions";
import {LightrailAndMerchantStripeConfig} from "./StripeConfig";
import {StripeRestError} from "./StripeRestError";
import {TransactionPlanError} from "../../lambdas/rest/transactions/TransactionPlanError";
import * as Stripe from "stripe";
import {MetricsLogger} from "../metricsLogger";
import {AdditionalStripeChargeParams, transactionPartySchema} from "../../model/TransactionRequest";
import log = require("loglevel");

export async function executeStripeSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, stripeConfig: LightrailAndMerchantStripeConfig, plan: TransactionPlan): Promise<void> {
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];
    try {
        for (const step of stripeSteps) {
            MetricsLogger.stripeCall(step, auth);
            if (step.type === "charge") {
                // These are internal errors for setups that should not get this far.
                if (step.minAmount && step.minAmount > -step.amount) {
                    throw new Error(`The transaction cannot be processed because it contains a Stripe charge (${-step.amount}) below the minimum (${step.minAmount}).`);
                }
                if (step.maxAmount && step.maxAmount < -step.amount) {
                    throw new Error(`The transaction cannot be processed because it contains a Stripe charge (${-step.amount}) above the minimum (${step.maxAmount}).`);
                }

                const stripeChargeParams = stripeTransactionPlanStepToStripeChargeRequest(auth, step, plan);
                step.chargeResult = await createCharge(stripeChargeParams, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, step.idempotentStepId);
            } else if (step.type === "refund") {
                const stripeRefundParams: Stripe.refunds.IRefundCreationOptionsWithCharge = {
                    charge: step.chargeId,
                    metadata: {
                        reason: step.reason || "not specified"
                    }
                };
                step.refundResult = await createRefund(stripeRefundParams, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id);

                if (step.reason) {
                    const updateChargeParams: Stripe.charges.IChargeUpdateOptions = {
                        description: step.reason
                    };
                    await updateCharge(step.chargeId, updateChargeParams, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id);
                    log.info(`Updated Stripe charge ${step.chargeId} with reason.`);
                }
            } else if (step.type === "capture") {
                if (step.amount < 0) {
                    throw new Error(`StripeTransactionPlanStep capture amount ${step.amount} is < 0. The number represents the delta from the original charge and must be >= 0 as we cannot capture additional value.`);
                }
                const captureParams: Stripe.charges.IChargeCaptureOptions = {
                    amount: step.amount ? step.pendingAmount - step.amount : undefined
                };
                step.captureResult = await captureCharge(step.chargeId, captureParams, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id);
            } else {
                throw new Error(`Unexpected stripe step. This should not happen. Step: ${JSON.stringify(step)}.`);
            }
        }
    } catch (err) {
        if ((err as StripeRestError).isStripeRestError) {
            MetricsLogger.stripeError((err as StripeRestError).stripeError, auth);
            // Error was returned from Stripe. Passing original error along so that details of Stripe failure can be returned.
            throw err;
        }

        throw new TransactionPlanError(`Transaction execution canceled because there was a problem calling Stripe: ${err.message}`, {
            isReplanable: false
        });
    }
}

function stripeTransactionPlanStepToStripeChargeRequest(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeChargeTransactionPlanStep, plan: TransactionPlan): Stripe.charges.IChargeCreationOptions {
    const stripeChargeParams: Stripe.charges.IChargeCreationOptions = {
        amount: -step.amount /* Lightrail treats debits as negative amounts on Steps but Stripe requires a positive amount when charging a credit card. */,
        currency: plan.currency,
        metadata: {
            ...plan.metadata,
            lightrailTransactionId: plan.id,
            lightrailTransactionSources: getLightrailTransactionSourcesSummary(step, plan),
            lightrailUserId: auth.userId
        }
    };
    if (plan.pendingVoidDate) {
        stripeChargeParams.capture = false;
    }
    if (step.source) {
        stripeChargeParams.source = step.source;
    }
    if (step.customer) {
        stripeChargeParams.customer = step.customer;
    }
    if (step.additionalStripeParams) {
        // Only copy these keys on to the charge request.  We don't want to accidentally
        // expose some kind of attack vector.
        const paramKeys: (keyof AdditionalStripeChargeParams)[] = Object.keys(transactionPartySchema.stripe.properties.additionalStripeParams.properties) as (keyof AdditionalStripeChargeParams)[];
        for (const key of paramKeys) {
            if (step.additionalStripeParams[key]) {
                stripeChargeParams[key] = step.additionalStripeParams[key];
            }
        }
    }

    log.debug("Created stepForStripe:", stripeChargeParams);
    return stripeChargeParams;
}

export async function rollbackStripeChargeSteps(lightrailStripeSecretKey: string, merchantStripeAccountId: string, steps: StripeChargeTransactionPlanStep[], reason: string): Promise<Stripe.refunds.IRefund[]> {
    let errorOccurredDuringRollback = false;
    const refunded: Stripe.refunds.IRefund[] = [];
    for (const step of steps) {
        try {
            const refundParams: Stripe.refunds.IRefundCreationOptionsWithCharge = {
                charge: step.chargeResult.id,
                amount: step.chargeResult.amount,
                metadata: {
                    reason: reason
                }
            };
            const refund = await createRefund(refundParams, lightrailStripeSecretKey, merchantStripeAccountId);
            log.info(`Refunded Stripe charge ${step.chargeResult.id}. Refund:`, refund);

            const updateChargeParams: Stripe.charges.IChargeUpdateOptions = {
                description: reason
            };
            await updateCharge(step.chargeResult.id, updateChargeParams, lightrailStripeSecretKey, merchantStripeAccountId);
            log.info(`Updated Stripe charge ${step.chargeResult.id} with reason.`);

            refunded.push(refund);
        } catch (err) {
            giftbitRoutes.sentry.sendErrorNotification(err);
            log.error("Exception occurred during refund while rolling back charge", step);
            errorOccurredDuringRollback = true;
        }
    }
    if (errorOccurredDuringRollback) {
        const chargeIds = steps.map(step => step.chargeResult.id);
        const refundedChargeIds = refunded.map(getRefundChargeId);
        throw new giftbitRoutes.GiftbitRestError(424, `Exception occurred during refund while rolling back charges. Charges that were attempted to be rolled back: ${chargeIds.toString()}. Could not refund: ${chargeIds.filter(chargeId => !refundedChargeIds.find(id => chargeId === id)).toString()}.`);
    }
    return refunded;
}

function getRefundChargeId(refund: Stripe.refunds.IRefund): string {
    if (typeof refund.charge === "string") {
        return refund.charge;
    }
    return refund.charge.id;
}

function getLightrailTransactionSourcesSummary(currentStep: StripeChargeTransactionPlanStep, plan: TransactionPlan): string {
    let summary = JSON.stringify(
        plan.steps.filter(step => !(step.rail === "stripe" && step.idempotentStepId === currentStep.idempotentStepId))
            .map(step => {
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
                        return {
                            rail: "stripe",
                            source: (step.type === "charge" && step.source) || undefined,
                            customer: (step.type === "charge" && step.customer) || undefined,
                        };
                }
            })
    );
    if (summary.length >= 500) {
        // Stripe allows a max length of 499 characters for any one metadata field.
        summary = summary.substr(0, 496) + "...";
    }
    return summary;
}

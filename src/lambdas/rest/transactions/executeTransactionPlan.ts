import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {
    StripeChargeTransactionPlanStep,
    StripeRefundTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
} from "./TransactionPlan";
import {Transaction} from "../../../model/Transaction";
import {TransactionPlanError} from "./TransactionPlanError";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import {setupLightrailAndMerchantStripeConfig} from "../../../utils/stripeUtils/stripeAccess";
import {LightrailAndMerchantStripeConfig} from "../../../utils/stripeUtils/StripeConfig";
import {
    insertInternalTransactionSteps,
    insertLightrailTransactionSteps,
    insertStripeTransactionSteps,
    insertTransaction
} from "./insertTransactions";
import {executeStripeSteps, rollbackStripeChargeSteps} from "../../../utils/stripeUtils/stripeStepOperations";
import {StripeRestError} from "../../../utils/stripeUtils/StripeRestError";
import {MetricsLogger} from "../../../utils/metricsLogger";
import log = require("loglevel");

export interface ExecuteTransactionPlannerOptions {
    allowRemainder: boolean;
    simulate: boolean;
}

/**
 * Calls the planner and executes on the plan created.  If the plan cannot be executed
 * but can be replanned then the planner will be called again.
 */
export async function executeTransactionPlanner(auth: giftbitRoutes.jwtauth.AuthorizationBadge, options: ExecuteTransactionPlannerOptions, planner: () => Promise<TransactionPlan>): Promise<Transaction> {
    while (true) {
        try {
            const plan = await planner();
            if ((plan.totals && plan.totals.remainder && !options.allowRemainder) ||
                plan.steps.find(step => step.rail === "lightrail" && step.value.balance != null && step.value.balance + step.amount < 0)) {
                throw new giftbitRoutes.GiftbitRestError(409, "Insufficient balance for the transaction.", "InsufficientBalance");
            }
            if (plan.steps.find(step => step.rail === "lightrail" && step.value.usesRemaining != null && step.value.usesRemaining + step.uses < 0)) {
                throw new giftbitRoutes.GiftbitRestError(409, "Insufficient usesRemaining for the transaction.", "InsufficientUsesRemaining");
            }

            if (options.simulate) {
                return TransactionPlan.toTransaction(auth, plan, options.simulate);
            }

            return await executeTransactionPlan(auth, plan);
        } catch (err) {
            log.warn("Error thrown executing transaction plan.", err);
            if ((err as TransactionPlanError).isTransactionPlanError && (err as TransactionPlanError).isReplanable) {
                log.info("Retrying. It's a TransactionPlanError and is replanable.");
                continue;
            }
            throw err;
        }
    }
}

export async function executeTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    auth.requireIds("userId", "teamMemberId");
    let stripeConfig: LightrailAndMerchantStripeConfig;
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];

    const knex = await getKnexWrite();

    await knex.transaction(async trx => {
        try {
            await insertTransaction(trx, auth, plan);
        } catch (err) {
            log.warn("Error inserting transaction:", err);
            if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "TransactionExists") {
                throw err;
            } else {
                giftbitRoutes.sentry.sendErrorNotification(err);
                throw err;
            }
        }

        try {
            if (stripeSteps.length > 0) {
                stripeConfig = await setupLightrailAndMerchantStripeConfig(auth);
                await executeStripeSteps(auth, stripeConfig, plan);
            }
            await insertStripeTransactionSteps(auth, trx, plan);
            await insertLightrailTransactionSteps(auth, trx, plan);
            await insertInternalTransactionSteps(auth, trx, plan);
        } catch (err) {
            log.error(`Error occurred while processing transaction steps: ${err}`);
            const stripeChargeSteps: StripeChargeTransactionPlanStep[] = stripeSteps.filter(step => step.type === "charge") as StripeChargeTransactionPlanStep[];
            if (stripeChargeSteps.length > 0) {
                const stripeChargeStepsToRefund = stripeChargeSteps.filter(step => step.chargeResult != null) as StripeChargeTransactionPlanStep[];
                if (stripeChargeStepsToRefund.length > 0) {
                    await rollbackStripeChargeSteps(stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, stripeChargeStepsToRefund, "Refunded due to error on the Lightrail side.");
                    log.warn(`An error occurred while processing transaction '${plan.id}'. The Stripe charge(s) '${stripeChargeStepsToRefund.map(step => step.chargeResult.id)}' have been refunded.`);
                }
            }

            const stripeRefundSteps: StripeRefundTransactionPlanStep[] = stripeSteps.filter(step => step.type === "refund") as StripeRefundTransactionPlanStep[];
            if (stripeRefundSteps.length > 0) {
                const stepsSuccessfullyRefunded: StripeRefundTransactionPlanStep[] = stripeRefundSteps.filter(step => step.refundResult != null);
                if (stepsSuccessfullyRefunded.length > 0) {
                    const message = `Exception ${JSON.stringify(err)} was thrown while processing steps. There was a refund that was successfully refunded but the exception was thrown after and refunds cannot be undone. This is a bad situation as the Transaction could not be saved.`;
                    log.error(message);
                    giftbitRoutes.sentry.sendErrorNotification(new Error(message));
                    throw new GiftbitRestError(424, `An irrecoverable exception occurred while reversing the Transaction ${plan.previousTransactionId}. The charges ${stepsSuccessfullyRefunded.map(step => step.chargeId).toString()} were refunded in Stripe but an exception occurred after and the Transaction could not be completed. Please review your records in Lightrail and Stripe to adjust for this situation.`);
                } else {
                    log.info(`An exception occurred while reversing transaction ${plan.previousTransactionId}. The reverse included refunds in Stripe but they were not successfully refunded. The state of Stripe and Lightrail are consistent.`);
                }
            }

            if ((err as StripeRestError).additionalParams && (err as StripeRestError).additionalParams.stripeError) {
                // Error was returned from Stripe. Passing original error along so that details of Stripe failure can be returned.
                throw err;
            } else if ((err as TransactionPlanError).isTransactionPlanError || err instanceof GiftbitRestError) {
                throw err;
            } else if (err.code === "ER_DUP_ENTRY") {
                log.error(err);
                giftbitRoutes.sentry.sendErrorNotification(err);
                throw new giftbitRoutes.GiftbitRestError(409, `A transaction step in transaction '${plan.id}' already exists. This should not be possible.`, "TransactionStepExists");
            } else {
                log.warn(err);
                giftbitRoutes.sentry.sendErrorNotification(err);
                throw new giftbitRoutes.GiftbitRestError(500, `An error occurred while processing transaction '${plan.id}'.`);
            }
        }
    });

    MetricsLogger.transaction(plan, auth);
    return TransactionPlan.toTransaction(auth, plan);
}

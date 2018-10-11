import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {StripeChargeTransactionPlanStep, StripeTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
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
import {processStripeSteps, rollbackStripeChargeSteps} from "../../../utils/stripeUtils/stripeStepOperations";
import {StripeRestError} from "../../../utils/stripeUtils/StripeRestError";
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
            if (plan.totals && plan.totals.remainder && !options.allowRemainder) {
                throw new giftbitRoutes.GiftbitRestError(409, "Insufficient balance for the transaction.", "InsufficientBalance");
            }
            if (options.simulate) {
                return TransactionPlan.toTransaction(auth, plan);
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
                await processStripeSteps(auth, stripeConfig, plan);
            }
            console.log("made it sdfgdf!")
            await insertStripeTransactionSteps(auth, trx, plan);
            console.log("made it heresAWERS!")
            await insertLightrailTransactionSteps(auth, trx, plan);
            await insertInternalTransactionSteps(auth, trx, plan);
        } catch (err) {
            log.warn(`Error inserting transaction step: ${err}`);
            if (stripeSteps.length > 0) {
                const stripeChargeStepsToRefund = stripeSteps.filter(step => step.type === "charge" && step.chargeResult != null) as StripeChargeTransactionPlanStep[];
                if (stripeChargeStepsToRefund.length > 0) {
                    await rollbackStripeChargeSteps(stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, stripeChargeStepsToRefund, `Refunded due to error on the Lightrail side`);
                    log.warn(`An error occurred while processing transaction '${plan.id}'. The Stripe charge(s) '${stripeChargeStepsToRefund.map(step => step.chargeResult.id)}' have been refunded.`);
                }
                if (stripeSteps.filter(step => step.type === "refund").length > 0) {
                    const message = `An error occurred while processing reverse transaction ${plan.id} with stripe refund charges. An exception occurred during transaction. The refunds ${JSON.stringify(stripeSteps)} cannot be undone.`;
                    log.warn(message);
                    giftbitRoutes.sentry.sendErrorNotification(new Error(message));
                }
            }

            if ((err as StripeRestError).additionalParams && (err as StripeRestError).additionalParams.stripeError) {
                // Error was returned from Stripe. Passing original error along so that details of Stripe failure can be returned.
                throw err;
            } else if ((err as TransactionPlanError).isTransactionPlanError) {
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

    return TransactionPlan.toTransaction(auth, plan);
}

import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {StripeTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {Transaction} from "../../../model/Transaction";
import {TransactionPlanError} from "./TransactionPlanError";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import log = require("loglevel");
import {setupLightrailAndMerchantStripeConfig} from "../../../utils/stripeUtils/stripeAccess";
import {LightrailAndMerchantStripeConfig} from "../../../utils/stripeUtils/StripeConfig";
import {
    insertInternalTransactionSteps,
    insertLightrailTransactionSteps,
    insertStripeTransactionSteps,
    insertTransaction
} from "./insertTransactions";
import {chargeStripeSteps, rollbackStripeSteps} from "../../../utils/stripeUtils/stripeStepOperations";

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
            if (plan.totals.remainder && !options.allowRemainder) {
                throw new giftbitRoutes.GiftbitRestError(409, "Insufficient balance for the transaction.", "InsufficientBalance");
            }
            if (options.simulate) {
                return TransactionPlan.toTransaction(auth, plan);
            }
            return await executeTransactionPlan(auth, plan);
        } catch (err) {
            log.warn(`Err ${err} was thrown.`);
            if ((err as TransactionPlanError).isTransactionPlanError && (err as TransactionPlanError).isReplanable) {
                log.info(`Retrying. It's a transaction plan error and it is replanable.`);
                continue;
            }
            throw err;
        }
    }
}

export async function executeTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    let chargeStripe = false;
    let stripeConfig: LightrailAndMerchantStripeConfig;
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];

    const knex = await getKnexWrite();

    await knex.transaction(async trx => {
        try {
            await insertTransaction(trx, auth, plan);
        } catch (err) {
            log.warn(`Error inserting transaction: ${err}`);
            if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "TransactionExists") {
                throw err;
            } else {
                giftbitRoutes.sentry.sendErrorNotification(err);
                throw err;
            }
        }

        if (stripeSteps.length > 0) {
            chargeStripe = true;
            stripeConfig = await setupLightrailAndMerchantStripeConfig(auth);
            await chargeStripeSteps(auth, stripeConfig, plan);
        }

        try {
            if (chargeStripe) {
                await insertStripeTransactionSteps(auth, trx, plan);
            }
            await insertLightrailTransactionSteps(auth, trx, plan);
            await insertInternalTransactionSteps(auth, trx, plan);
        } catch (err) {
            log.warn(`Error inserting transaction step: ${err}`);
            if (chargeStripe) {
                await rollbackStripeSteps(stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, stripeSteps, `Refunded due to error on the Lightrail side`);
                log.warn(`An error occurred while processing transaction '${plan.id}'. The Stripe charge(s) '${stripeSteps.map(step => step.chargeResult.id)}' have been refunded.`);
            }

            if ((err as TransactionPlanError).isTransactionPlanError) {
                throw err;
            } else if (err.code === "ER_DUP_ENTRY") {
                log.debug(err);
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

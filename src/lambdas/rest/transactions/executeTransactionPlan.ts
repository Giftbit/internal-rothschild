import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, StripeTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {DbTransactionStep, Transaction} from "../../../model/Transaction";
import {DbValue} from "../../../model/Value";
import {transactionPlanToTransaction} from "./transactionPlanToTransaction";
import {TransactionPlanError} from "./TransactionPlanError";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import * as log from "loglevel";
import {createStripeCharge, rollbackStripeSteps} from "../../../utils/stripeUtils/stripeTransactions";
import {StripeRestError} from "../../../utils/stripeUtils/StripeRestError";
import {setupLightrailAndMerchantStripeConfig} from "../../../utils/stripeUtils/stripeAccess";
import {StripeTransactionParty} from "../../../model/TransactionRequest";
import {StripeCreateChargeParams} from "../../../utils/stripeUtils/StripeCreateChargeParams";
import Knex = require("knex");

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
                throw new giftbitRoutes.GiftbitRestError(409, "Insufficient value for the transaction.", "InsufficientValue");
            }
            if (options.simulate) {
                return transactionPlanToTransaction(plan);
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

export function executeTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    const messy = plan.steps.find(step => step.rail !== "lightrail" && step.rail !== "internal");
    return messy ? executeMessyTransactionPlan(auth, plan) : executePureTransactionPlan(auth, plan);
}

/**
 * Execute a transaction plan that can be done as a single SQL transaction
 * locking on Values.
 */
async function executePureTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    const knex = await getKnexWrite();
    await knex.transaction(async trx => {
        plan.createdDate = nowInDbPrecision(); // todo - should this be defined earlier?
        await transactionUtility.insertTransaction(trx, auth, plan);
        await transactionUtility.processLightrailSteps(auth, trx, plan.steps as LightrailTransactionPlanStep[], plan.id, plan.createdDate);
    });

    return transactionPlanToTransaction(plan);
}

/**
 * Execute a transaction plan that transacts against other systems and requires
 * create-pending and capture-pending logic.
 */
async function executeMessyTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    if (plan.steps.find(step => step.rail === "internal")) {
        throw new Error("Not implemented");
    }

    const stripeConfig = await setupLightrailAndMerchantStripeConfig(auth);

    const knex = await getKnexWrite();

    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];
    const lrSteps = plan.steps.filter(step => step.rail === "lightrail") as LightrailTransactionPlanStep[];

    try {
        for (let stepIx in stripeSteps) {
            const step = stripeSteps[stepIx];
            const stepForStripe = stripeTransactionPlanStepToStripeRequest(step, plan);
            // todo handle edge case: stripeAmount < 50    --> do this in planner

            const charge = await createStripeCharge(stepForStripe, stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, step.idempotentStepId);

            // Update transaction plan with charge details
            step.chargeResult = charge;
            // trace back to the requested payment source that lists the right 'source' and/or 'customer' param
            let stepSource = plan.paymentSources.find(
                source => source.rail === "stripe" &&
                    (step.source ? source.source === step.source : true) &&
                    (step.customer ? source.customer === step.customer : true)
            ) as StripeTransactionParty;
            stepSource.chargeId = charge.id;
        }
        // await doFraudCheck(lightrailStripeConfig, merchantStripeConfig, params, charge, evt, auth);
    } catch (err) {
        // todo: differentiate between stripe errors / db step errors, and fraud check errors once we do fraud checking: rollback if appropriate & make sure message is clear
        if ((err as StripeRestError).additionalParams.stripeError) {
            throw err;
        } else {
            throw new TransactionPlanError(`Transaction execution canceled because there was a problem charging Stripe: ${err}`, {
                isReplanable: false
            });
        }
    }

    await knex.transaction(async trx => {
        plan.createdDate = nowInDbPrecision(); // todo - should this be defined earlier?

        try {
            await transactionUtility.insertTransaction(trx, auth, plan);
        } catch (err) {
            if ((err as GiftbitRestError).statusCode === 409 && err.additionalParams.messageCode === "TransactionExists") {
                await rollbackStripeSteps(stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, stripeSteps, `Refunded because transaction already exists on Lightrail side: ${JSON.stringify(err)}`);
                err.message = `${err.message} The associated Stripe charge(s) '${stripeSteps.map(step => step.chargeResult.id)}' have been refunded.`;
                throw err;
            } else {
                await rollbackStripeSteps(stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, stripeSteps, `Refunded due to error on the Lightrail side: ${JSON.stringify(err)}`);
                throw err;
            }
        }

        try {
            for (let stepIx in stripeSteps) {
                let step = stripeSteps[stepIx];
                await trx.into("StripeTransactionSteps")
                    .insert({
                        userId: auth.giftbitUserId,
                        id: step.idempotentStepId,
                        transactionId: plan.id,
                        chargeId: step.chargeResult.id,
                        currency: step.chargeResult.currency,
                        amount: step.chargeResult.amount,
                        charge: JSON.stringify(step.chargeResult)
                    });
            }
            await transactionUtility.processLightrailSteps(auth, trx, lrSteps, plan.id, plan.createdDate);
        } catch (err) {
            await rollbackStripeSteps(stripeConfig.lightrailStripeConfig.secretKey, stripeConfig.merchantStripeConfig.stripe_user_id, stripeSteps, `Refunded due to error on the Lightrail side: ${JSON.stringify(err)}`);

            if (err.code === "ER_DUP_ENTRY") {
                throw new giftbitRoutes.GiftbitRestError(409, `A transaction step in transaction '${plan.id}' already exists: stepId=${""}`, "TransactionStepExists");
            } else {
                throw new giftbitRoutes.GiftbitRestError(500, `An error occurred while processing transaction '${plan.id}'. The Stripe charge(s) '${stripeSteps.map(step => step.chargeResult.id)}' have been refunded.`);
            }
        }
    });

    return transactionPlanToTransaction(plan);
}


function stripeTransactionPlanStepToStripeRequest(step: StripeTransactionPlanStep, plan: TransactionPlan): StripeCreateChargeParams {
    let stepForStripe: StripeCreateChargeParams = {
        amount: step.amount,
        currency: plan.currency,
        metadata: {
            ...plan.metadata,
            lightrailTransactionId: plan.id
        }
    };
    if (step.source) {
        stepForStripe.source = step.source;
    }
    if (step.customer) {
        stepForStripe.customer = step.customer;
    }

    return stepForStripe;
}

export const transactionUtility = {
    // this function is now a method on an exported object to make it easy to mock in tests that simulate errors
    processLightrailSteps: async function processLightrailSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, steps: LightrailTransactionPlanStep[], transactionId: string, createdDate: Date) {

        for (let stepIx = 0; stepIx < steps.length; stepIx++) {
            const step = steps[stepIx] as LightrailTransactionPlanStep;

            let updateProperties: any = {
                updatedDate: createdDate
            };

            let query = trx.into("Values")
                .where({
                    userId: auth.giftbitUserId,
                    id: step.value.id
                });
            if (step.amount !== 0 && step.amount !== null) {
                updateProperties.balance = trx.raw(`balance + ?`, [step.amount]);
            }
            if (step.amount < 0 && !step.value.valueRule /* if it has a valueRule then balance is 0 or null */) {
                query = query.where("balance", ">=", -step.amount);
            }
            if (step.value.uses !== null) {
                query = query.where("uses", ">", 0);
                updateProperties.uses = trx.raw(`uses - 1`);
            }
            query = query.update(updateProperties);

            const res = await query;
            if (res !== 1) {
                throw new TransactionPlanError(`Transaction execution canceled because Value updated ${res} rows.  userId=${auth.giftbitUserId} valueId=${step.value.id} value=${step.value.balance} uses=${step.value.uses} step.amount=${step.amount}`, {
                    isReplanable: res === 0
                });
            }

            const res2: DbValue[] = await trx.from("Values")
                .where({
                    userId: auth.giftbitUserId,
                    id: step.value.id
                })
                .select();

            if (res2.length !== 1) {
                throw new TransactionPlanError(`Transaction execution canceled because the Value that was updated could not be refetched.  This should never happen.  userId=${auth.giftbitUserId} valueId=${step.value.id}`, {
                    isReplanable: false
                });
            }

            // Fix the plan to indicate the true value change.
            step.value.balance = res2[0].balance - step.amount;

            let balanceInfo = {
                balanceBefore: res2[0].balance - step.amount,
                balanceAfter: res2[0].balance,
                balanceChange: step.amount
            };

            if (step.value.valueRule !== null) {
                balanceInfo.balanceBefore = 0;
                balanceInfo.balanceAfter = 0;
            } else {
                // Fix the plan to indicate the true value change.
                step.value.balance = res2[0].balance - step.amount;
            }


            await trx.into("LightrailTransactionSteps")
                .insert({
                    userId: auth.giftbitUserId,
                    id: `${transactionId}-${stepIx}`,
                    transactionId: transactionId,
                    valueId: step.value.id,
                    contactId: step.value.contactId,
                    code: step.value.code,
                    ...balanceInfo
                });
        }

    },

    // this function is now a method on an exported object to make it easy to mock in tests that simulate errors
    insertTransaction: async function (trx: Knex, auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan) {
        try {
            await trx.into("Transactions")
                .insert({
                    userId: auth.giftbitUserId,
                    id: plan.id,
                    transactionType: plan.transactionType,
                    currency: plan.currency,
                    totals: JSON.stringify(plan.totals),
                    lineItems: JSON.stringify(plan.lineItems),
                    paymentSources: JSON.stringify(plan.paymentSources),
                    metadata: JSON.stringify(plan.metadata),
                    createdDate: plan.createdDate
                });
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new giftbitRoutes.GiftbitRestError(409, `A Lightrail transaction with transactionId '${plan.id}' already exists.`, "TransactionExists");
            }
        }
    }
};

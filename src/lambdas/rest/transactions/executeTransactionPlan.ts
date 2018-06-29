import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, StripeTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {DbTransactionStep, Transaction} from "../../../model/Transaction";
import {DbValue} from "../../../model/Value";
import {transactionPlanToTransaction} from "./transactionPlanToTransaction";
import {TransactionPlanError} from "./TransactionPlanError";
import {getKnexWrite} from "../../../dbUtils/connection";
import {httpStatusCode} from "cassava";
import {StripeTransactionParty} from "../../../model/TransactionRequest";
import {setupLightrailAndMerchantStripeConfig} from "../../utils/stripeUtils/stripeAccess";
import {nowInDbPrecision} from "../../../dbUtils";
import * as log from "loglevel";
import Knex = require("knex");
import Stripe = require("stripe");
import ICharge = Stripe.charges.ICharge;

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
        await insertTransaction(trx, auth, plan);
        await processLightrailSteps(auth, trx, plan.steps as LightrailTransactionPlanStep[], plan.id, plan.createdDate);
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

    // try {
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
    //    // await doFraudCheck(lightrailStripeConfig, merchantStripeConfig, params, charge, evt, auth);
    // } catch (err) {
    //     console.log("ERROR=" + JSON.stringify(err, null, 4));
    //     // TODO tana - need to adapt this to fit this context: rollback should mean refund Stripe charges and refund LR charges (void if we use pending flow)
    //     // console.log(`An error occurred during card creation. Error: ${JSON.stringify(err)}.`);
    //     // await rollback(lightrailStripeConfig, merchantStripeConfig, charge, card, "Refunded due to an unexpected error during gift card creation in Lightrail.");
    //     //
    //     // if (err.status === 400) {
    //     //     throw new RestError(httpStatusCode.clientError.BAD_REQUEST, err.body.message);
    //     // } else {
    //     //     throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    //     // }
    // }


    // await knex.transaction(async trx => {  // todo wrap everything
    plan.createdDate = nowInDbPrecision(); // todo - should this be defined earlier?
    await insertTransaction(knex, auth, plan);  // todo make sure we throw the right error message if duplicate transaction

    try {
        for (let stepIx in stripeSteps) {
            let step = stripeSteps[stepIx];
            await knex.into("StripeTransactionSteps")
                .insert({
                    userId: auth.giftbitUserId,
                    id: step.idempotentStepId,
                    transactionId: plan.id,
                    chargeId: step.chargeResult.id,
                    currency: step.chargeResult.currency,
                    amount: step.chargeResult.amount,
                    charge: JSON.stringify(step.chargeResult)
                });

            const sanityCheckStripeStep: DbTransactionStep[] = await knex.from("StripeTransactionSteps")
                .where({chargeId: step.chargeResult.id})
                .select();
            if (sanityCheckStripeStep.length !== 1) {
                throw new TransactionPlanError(`Transaction execution canceled because Stripe transaction step updated ${sanityCheckStripeStep.length} rows.  rows: ${JSON.stringify(sanityCheckStripeStep)}`, {
                    isReplanable: false
                });
            }
        }

        await processLightrailSteps(auth, knex, lrSteps, plan.id, plan.createdDate);

    } catch (err) {
        log.debug("ERROR=" + JSON.stringify(err, null, 4));
        // TODO tana - need to adapt this to fit this context: rollback should mean refund Stripe charges and refund LR charges (void if we use pending flow)
    }
    // });

    // TODO FIX PLACEHOLDER: NEED TO UPDATE PLAN BEFORE CONVERTING
    return transactionPlanToTransaction(plan);
}


// STRIPE HELPERS

function stripeTransactionPlanStepToStripeRequest(step: StripeTransactionPlanStep, plan: TransactionPlan) { // TODO use existing interface/namespace? StripeChargeRequest or something? 4 versions of stripe steps (?!): TransactionPlanStep, TransactionStep, database, and what gets sent to stripe
    let stepForStripe: any = {
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

async function createStripeCharge(params: any, lightrailStripeSecretKey: string, merchantStripeAccountId: string, stepIdempotencyKey: string): Promise<ICharge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    // params.description = "Lightrail Checkout transaction.";  // todo what is this
    log.info(`Creating transaction ${JSON.stringify(params)}.`);

    let charge: ICharge;
    try {
        charge = await lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
            idempotency_key: stepIdempotencyKey
        });
    } catch (err) {
        log.info("\n\nERROR CHARGING STRIPE: \n" + err);   // todo add more detail: chargId? we will support more than one stripe source, needs to be identifiable
        switch (err.type) {
            case "StripeCardError":
                throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "Failed to charge credit card..", "ChargeFailed");
            case "StripeInvalidRequestError":
                throw new GiftbitRestError(httpStatusCode.clientError.BAD_REQUEST, "The stripeCardToken was invalid.", "StripeInvalidRequestError");
            case "RateLimitError":
                throw new GiftbitRestError(httpStatusCode.clientError.TOO_MANY_REQUESTS, `Service was rate limited by dependent service.`, "DependentServiceRateLimited"); // technically this is up to us to handle once we're past mvp stage
            default:
                throw new Error(`An unexpected error occurred while attempting to charge card. error ${err}`);
        }
    }
    log.info(`Created charge ${JSON.stringify(charge)}`); // todo is this safe to log?
    return charge;
}

// TODO tana - need to adapt this to fit this context: rollback should mean refund Stripe charges and refund LR charges (void if we use pending flow)
// async function rollback(lightrailStripeConfig: StripeModeConfig, merchantStripeConfig: StripeAuth, charge: Charge, card: Card, reason: string): Promise<void> {
//     const refund = await createRefund(charge.id, lightrailStripeConfig.secretKey, merchantStripeConfig.stripe_user_id, reason);
//     console.log(`Refunded charge ${charge.id}. Refund: ${JSON.stringify(refund)}.`);
//     if (card) {
//         const cancel = await lightrail.cards.cancelCard(card, card.cardId + "-cancel");
//         console.log(`Cancelled card ${card.cardId}. Cancel response: ${cancel}.`);
//     }
// }


async function insertTransaction(trx: Knex, auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan) {
    try {
        await trx.into("Transactions")
            .insert({
                userId: auth.giftbitUserId,
                id: plan.id,
                transactionType: plan.transactionType,
                currency: plan.currency,
                totals: JSON.stringify(plan.totals),
                lineItems: JSON.stringify(plan.lineItems),
                paymentSources: JSON.stringify(plan.paymentSources), // todo check format: stripe token?
                metadata: JSON.stringify(plan.metadata),
                createdDate: plan.createdDate
            });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId '${plan.id}' already exists.`, "TransactionExists");
        }
    }
}

async function processLightrailSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, steps: LightrailTransactionPlanStep[], transactionId: string, createdDate: Date) {
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


        // did this section get safely updated in the merge?
        //
        // for (let stepIx = 0; stepIx < steps.length; stepIx++) {
        // const step = steps[stepIx] as LightrailTransactionPlanStep;
        // let query = trx.into("Values")
        //     .where({
        //         userId: auth.giftbitUserId,
        //         id: step.value.id
        //     })
        //     .increment("balance", step.amount);
        // if (step.amount < 0 && !step.value.valueRule /* if it has a valueRule then balance is 0 or null */) {
        //     query = query.where("balance", ">=", -step.amount);
        // }
        // if (step.value.uses !== null) {
        //     query = query.where("uses", ">", 0)
        //         .increment("uses", -1);
        // }

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

}

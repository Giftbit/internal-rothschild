import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
} from "./TransactionPlan";
import {TransactionPlanError} from "./TransactionPlanError";
import {DbValue} from "../../../model/Value";
import Knex = require("knex");

export async function insertTransaction(trx: Knex, auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan) {
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
        } else {
            throw err;
        }
    }
}

export async function insertLightrailTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan) {
    const steps = plan.steps.filter(step => step.rail === "lightrail");
    for (let stepIx = 0; stepIx < steps.length; stepIx++) {
        const step = steps[stepIx] as LightrailTransactionPlanStep;

        let updateProperties: any = {
            updatedDate: plan.createdDate
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

        const updateRes = await query;
        if (updateRes !== 1) {
            throw new TransactionPlanError(`Transaction execution canceled because Value updated ${updateRes} rows.  userId=${auth.giftbitUserId} valueId=${step.value.id} value=${step.value.balance} uses=${step.value.uses} step.amount=${step.amount}`, {
                isReplanable: updateRes === 0
            });
        }

        const selectRes: DbValue[] = await trx.from("Values")
            .where({
                userId: auth.giftbitUserId,
                id: step.value.id
            })
            .select();

        if (selectRes.length !== 1) {
            throw new TransactionPlanError(`Transaction execution canceled because the Value that was updated could not be refetched.  This should never happen.  userId=${auth.giftbitUserId} valueId=${step.value.id}`, {
                isReplanable: false
            });
        }

        /**
         * IMPORTANT: This is for display purposes only. This sets value.balance to be what it was before the transaction was applied.
         * This is important for displaying balanceBefore/After so that the code can work the same way for simulated and real transactions.
         */
        step.value.balance = selectRes[0].balance - step.amount;

        await trx.into("LightrailTransactionSteps")
            .insert(LightrailTransactionPlanStep.toLightrailDbTransactionStep(step, plan, auth, stepIx));
    }
}

export async function insertStripeTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan) {
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];
    for (let step of stripeSteps) {
        await trx.into("StripeTransactionSteps")
            .insert(StripeTransactionPlanStep.toStripeDbTransactionStep(step, plan, auth));
    }
}

export async function insertInternalTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan) {
    const internalSteps = plan.steps.filter(step => step.rail === "internal") as InternalTransactionPlanStep[];
    for (let step of internalSteps) {
        await trx.into("InternalTransactionSteps")
            .insert(InternalTransactionPlanStep.toInternalDbTransactionStep(step, plan, auth));
    }
}
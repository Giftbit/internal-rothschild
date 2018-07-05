import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
} from "../../lambdas/rest/transactions/TransactionPlan";
import {TransactionPlanError} from "../../lambdas/rest/transactions/TransactionPlanError";
import {DbValue} from "../../model/Value";
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

        // Fix the plan to indicate the true value change.
        step.value.balance = selectRes[0].balance - step.amount;

        let balanceInfo = {
            balanceBefore: selectRes[0].balance - step.amount,
            balanceAfter: selectRes[0].balance,
            balanceChange: step.amount
        };

        if (step.value.valueRule !== null) {
            balanceInfo.balanceBefore = 0;
            balanceInfo.balanceAfter = 0;
        } else {
            // Fix the plan to indicate the true value change.
            step.value.balance = selectRes[0].balance - step.amount;
        }


        await trx.into("LightrailTransactionSteps")
            .insert({
                userId: auth.giftbitUserId,
                id: `${plan.id}-${stepIx}`,
                transactionId: plan.id,
                valueId: step.value.id,
                contactId: step.value.contactId,
                code: step.value.code,
                ...balanceInfo
            });
    }
}

export async function insertStripeTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan) {
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe") as StripeTransactionPlanStep[];
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
}

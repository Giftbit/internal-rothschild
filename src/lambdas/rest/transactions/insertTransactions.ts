import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
} from "./TransactionPlan";
import {TransactionPlanError} from "./TransactionPlanError";
import {DbValue} from "../../../model/Value";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import Knex = require("knex");

export async function insertTransaction(trx: Knex, auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<void> {
    try {
        let dbT: DbTransaction = Transaction.toDbTransaction(auth, TransactionPlan.toTransaction(auth, plan));
        dbT.rootTransactionId = plan.rootTransactionId ? plan.rootTransactionId : plan.id;
        await trx.into("Transactions")
            .insert(dbT);
        if (plan.previousTransactionId) {
            let updateProperties: { [P in keyof DbTransaction]?: DbTransaction[P] | Knex.Raw } = {
                nextTransactionId: plan.id,
            };
            await trx.into("Transactions")
                .where({
                    userId: auth.userId,
                    id: plan.previousTransactionId,
                    nextTransactionId: null
                }).update(updateProperties);
        }
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(409, `A Lightrail transaction with transactionId '${plan.id}' already exists.`, "TransactionExists");
        } else {
            throw err;
        }
    }
}

export async function insertLightrailTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan): Promise<void> {
    const steps = plan.steps.filter(step => step.rail === "lightrail");
    for (let stepIx = 0; stepIx < steps.length; stepIx++) {
        const step = steps[stepIx] as LightrailTransactionPlanStep;

        if (step.value.balance != null || step.value.usesRemaining != null) {
            await updateLightrailValueForStep(auth, trx, step, plan);
        }

        await trx.into("LightrailTransactionSteps")
            .insert(LightrailTransactionPlanStep.toLightrailDbTransactionStep(step, plan, auth, stepIx));
    }
}

async function updateLightrailValueForStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, step: LightrailTransactionPlanStep, plan: TransactionPlan): Promise<void> {
    let updateProperties: { [P in keyof DbValue]?: DbValue[P] | Knex.Raw } = {
        updatedDate: plan.createdDate
    };

    let query = trx.into("Values")
        .where({
            userId: auth.userId,
            id: step.value.id,
            frozen: false,
            active: true,
            canceled: false
        });
    if (step.value.balance != null && step.amount !== 0 && step.amount != null) {
        updateProperties.balance = trx.raw(`balance + ?`, [step.amount]);
        if (step.amount < 0) {
            query = query.where("balance", ">=", -step.amount);
        }
    }
    if (step.value.usesRemaining != null && step.uses !== 0 && step.uses != null) {
        updateProperties.usesRemaining = trx.raw("usesRemaining + ?", [step.uses]);
        if (step.uses < 0) {
            query = query.where("usesRemaining", ">=", -step.uses);
        }
    }
    query = query.update(updateProperties);

    const updateRes = await query;
    if (updateRes !== 1) {
        // todo - I don't think this replanning works. By this point the Transaction will be written to the DB but the database transaction will not have yet been committed.
        throw new TransactionPlanError(`Transaction execution canceled because Value updated ${updateRes} rows.  userId=${auth.userId} value.id=${step.value.id} value.balance=${step.value.balance} value.usesRemaining=${step.value.usesRemaining} step.amount=${step.amount} step.uses=${step.uses}`, {
            isReplanable: updateRes === 0
        });
    }

    const selectRes: DbValue[] = await trx.from("Values")
        .where({
            userId: auth.userId,
            id: step.value.id
        })
        .select();

    if (selectRes.length !== 1) {
        throw new TransactionPlanError(`Transaction execution canceled because the Value that was updated could not be refetched.  This should never happen.  userId=${auth.userId} valueId=${step.value.id}`, {
            isReplanable: false
        });
    }

    /**
     * IMPORTANT: This is for display purposes only. This sets value.balance to be what it was before the transaction was applied.
     * This is important for displaying balanceBefore/After so that the code can work the same way for simulated and real transactions.
     */
    if (step.value.balance != null) {
        step.value.balance = selectRes[0].balance - step.amount;
    }
    if (step.value.usesRemaining != null && step.uses != null) {
        step.value.usesRemaining = selectRes[0].usesRemaining - step.uses;
    }
}

export async function insertStripeTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan): Promise<void> {
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe")
        .map(step => StripeTransactionPlanStep.toStripeDbTransactionStep(step as StripeTransactionPlanStep, plan, auth));
    await trx.into("StripeTransactionSteps")
        .insert(stripeSteps);
}

export async function insertInternalTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan): Promise<void> {
    const internalSteps = plan.steps.filter(step => step.rail === "internal")
        .map(step => InternalTransactionPlanStep.toInternalDbTransactionStep(step as InternalTransactionPlanStep, plan, auth));
    await trx.into("InternalTransactionSteps")
        .insert(internalSteps);
}

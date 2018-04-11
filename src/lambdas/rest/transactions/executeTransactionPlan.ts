import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {Transaction} from "../../../model/Transaction";
import {getKnexWrite} from "../../../dbUtils";
import {DbValueStore} from "../../../model/ValueStore";
import {transactionPlanToTransaction} from "./transactionPlanToTransaction";
import {TransactionPlanError} from "./TransactionPlanError";

export function executeTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    const messy = plan.steps.find(step => step.rail !== "lightrail" && step.rail !== "internal");
    return messy ? executeMessyTransactionPlan(auth, plan) : executePureTransactionPlan(auth, plan);
}

/**
 * Execute a transaction plan that can be done as a single SQL transaction
 * locking on ValueStores.
 */
async function executePureTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    const now = new Date();
    now.setMilliseconds(0);
    const knex = await getKnexWrite();
    await knex.transaction(async trx => {
        try {
            await trx.into("Transactions")
                .insert({
                    userId: auth.giftbitUserId,
                    transactionId: plan.transactionId,
                    transactionType: plan.transactionType,
                    cart: null,
                    requestedPaymentSources: null,
                    remainder: plan.remainder,
                    createdDate: now
                });
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId '${plan.transactionId}' already exists.`, "TransactionExists");
            }
        }

        for (let stepIx = 0; stepIx < plan.steps.length; stepIx++) {
            const step = plan.steps[stepIx] as LightrailTransactionPlanStep;
            let query = trx.into("ValueStores")
                .where({
                    userId: auth.giftbitUserId,
                    valueStoreId: step.valueStore.valueStoreId
                })
                .increment("value", step.amount);
            if (step.amount < 0) {
                query = query.where("value", ">=", -step.amount);
            }
            if (step.valueStore.uses !== null) {
                query = query.where("uses", ">", 0)
                    .increment("uses", -1);
            }

            const res = await query;
            if (res !== 1) {
                throw new TransactionPlanError(res === 0, `Transaction execution canceled because value store updated ${res} rows.  userId=${auth.giftbitUserId} valueStoreId=${step.valueStore.valueStoreId} value=${step.valueStore.value} uses=${step.valueStore.uses} step.amount=${step.amount}`);
            }

            const res2: DbValueStore[] = await trx.from("ValueStores")
                .where({
                    userId: auth.giftbitUserId,
                    valueStoreId: step.valueStore.valueStoreId
                })
                .select();

            if (res2.length !== 1) {
                throw new TransactionPlanError(false, `Transaction execution canceled because the value store that was updated could not be refetched.  This should never happen.  userId=${auth.giftbitUserId} valueStoreId=${step.valueStore.valueStoreId}`);
            }

            // Fix the plan to indicate the true value change.
            step.valueStore.value = res2[0].value - step.amount;

            await trx.into("LightrailTransactionSteps")
                .insert({
                    userId: auth.giftbitUserId,
                    lightrailTransactionStepId: `${plan.transactionId}-${stepIx}`,
                    transactionId: plan.transactionId,
                    valueStoreId: step.valueStore.valueStoreId,
                    customerId: step.customerId,
                    codeLastFour: step.codeLastFour,
                    valueBefore: res2[0].value - step.amount,
                    valueAfter: res2[0].value,
                    valueChange: step.amount
                });
        }
    });

    return transactionPlanToTransaction(plan);
}

/**
 * Execute a transaction plan that transacts against other systems and requires
 * create-pending and capture-pending logic.
 */
function executeMessyTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    throw new Error("Not implemented");
}

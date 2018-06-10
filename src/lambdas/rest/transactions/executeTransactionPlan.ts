import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {Transaction} from "../../../model/Transaction";
import {nowInDbPrecision} from "../../../dbUtils/index";
import {DbValue} from "../../../model/Value";
import {transactionPlanToTransaction} from "./transactionPlanToTransaction";
import {TransactionPlanError} from "./TransactionPlanError";
import {getKnexWrite} from "../../../dbUtils/connection";

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
            if ((err as TransactionPlanError).isTransactionPlanError && (err as TransactionPlanError).isReplanable) {
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
    const now = nowInDbPrecision();
    const knex = await getKnexWrite();
    await knex.transaction(async trx => {
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
                    metadata: plan.metadata,
                    createdDate: now
                });
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId '${plan.id}' already exists.`, "TransactionExists");
            }
        }

        for (let stepIx = 0; stepIx < plan.steps.length; stepIx++) {
            const step = plan.steps[stepIx] as LightrailTransactionPlanStep;
            let query = trx.into("Values")
                .where({
                    userId: auth.giftbitUserId,
                    id: step.value.id
                })
                .increment("balance", step.amount);
            if (step.amount < 0) {
                query = query.where("balance", ">=", -step.amount);
            }
            if (step.value.uses !== null) {
                query = query.where("uses", ">", 0)
                    .increment("uses", -1);
            }

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

            await trx.into("LightrailTransactionSteps")
                .insert({
                    userId: auth.giftbitUserId,
                    id: `${plan.id}-${stepIx}`,
                    transactionId: plan.id,
                    valueId: step.value.id,
                    contactId: step.value.contactId,
                    code: step.value.code,
                    balanceBefore: res2[0].balance - step.amount,
                    balanceAfter: res2[0].balance,
                    balanceChange: step.amount
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

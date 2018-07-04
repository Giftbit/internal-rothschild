import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {Transaction} from "../../../model/Transaction";
import {DbValue} from "../../../model/Value";
import {transactionPlanToTransaction} from "./transactionPlanToTransaction";
import {TransactionPlanError} from "./TransactionPlanError";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import * as log from "loglevel";

// import * as log from "loglevel";

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
                throw new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId '${plan.id}' already exists.`, "TransactionExists");
            }
        }

        for (let stepIx = 0; stepIx < plan.steps.length; stepIx++) {
            const step = plan.steps[stepIx] as LightrailTransactionPlanStep;

            let updateProperties: any = {
                updatedDate: plan.createdDate
            };

            let query = trx.into("Values")
                .where({
                    userId: auth.giftbitUserId,
                    id: step.value.id
                });
            if (step.amount !== 0 && step.amount !== null) {
                updateProperties.balance = knex.raw(`balance + ?`, [step.amount]);
            }
            if (step.amount < 0 && !step.value.valueRule /* if it has a valueRule then balance is 0 or null */) {
                query = query.where("balance", ">=", -step.amount);
            }
            if (step.value.uses !== null) {
                query = query.where("uses", ">", 0);
                updateProperties.uses = knex.raw(`uses - 1`);
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
                    id: `${plan.id}-${stepIx}`,
                    transactionId: plan.id,
                    valueId: step.value.id,
                    contactId: step.value.contactId,
                    code: step.value.code,
                    ...balanceInfo
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

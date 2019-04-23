import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
} from "./TransactionPlan";
import {TransactionPlanError} from "./TransactionPlanError";
import {DbValue, Value} from "../../../model/Value";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {executeStripeSteps} from "../../../utils/stripeUtils/stripeStepOperations";
import {LightrailAndMerchantStripeConfig} from "../../../utils/stripeUtils/StripeConfig";
import {getSqlErrorConstraintName} from "../../../utils/dbUtils";
import * as cassava from "cassava";
import {GenerateCodeParameters} from "../../../model/GenerateCodeParameters";
import {generateCode} from "../../../utils/codeGenerator";
import Knex = require("knex");
import log = require("loglevel");

export async function insertTransaction(trx: Knex, auth: giftbitRoutes.jwtauth.AuthorizationBadge, plan: TransactionPlan): Promise<Transaction> {
    try {
        const transaction = TransactionPlan.toTransaction(auth, plan);
        let dbT: DbTransaction = Transaction.toDbTransaction(auth, transaction);
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
        return transaction;
    } catch (err) {
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "fk_Transaction_Currencies") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${plan.currency}' does not exist. See the documentation on creating currencies.`, "CurrencyNotFound");
        } else if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(409, `A Lightrail transaction with transactionId '${plan.id}' already exists.`, "TransactionExists");
        } else {
            throw err;
        }
    }
}

export async function insertLightrailTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan): Promise<TransactionPlan> {
    const steps = plan.steps.filter(step => step.rail === "lightrail") as LightrailTransactionPlanStep[];
    for (let stepIx = 0; stepIx < steps.length; stepIx++) {
        const step = steps[stepIx];

        switch (step.action) {
            case "INSERT_VALUE":
                await insertValue(auth, trx, step.value, step.codeParamsForRetry);
                break;
            case "UPDATE_VALUE":
                await updateLightrailValueForStep(auth, trx, step, plan);
                break;
            default:
                throw new Error(`Unexpected step value action ${step.action}. This should not happen`);
        }

        await trx.into("LightrailTransactionSteps")
            .insert(LightrailTransactionPlanStep.toLightrailDbTransactionStep(step, plan, auth, stepIx));
    }
    return plan;
}

export async function insertValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, value: Value, codeParamsForRetry: GenerateCodeParameters, retryCount = 0): Promise<DbValue> {
    if (value.balance < 0) {
        throw new Error("balance cannot be negative");
    }
    if (value.usesRemaining < 0) {
        throw new Error("usesRemaining cannot be negative");
    }

    const dbValue: DbValue = await Value.toDbValue(auth, value);
    try {
        await trx("Values")
            .insert(dbValue);

    } catch (err) {
        log.debug(err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with id '${value.id}' already exists.`, "ValueIdExists");
        }
        if (constraint === "uq_Values_codeHashed") {
            if (codeParamsForRetry != null && retryCount < 2) {
                /*  Retrying twice is an arbitrary number. This may need to be increased if we're still seeing regular failures.
                 *  Unless users are using their own character set there are around 1 billion possible codes.
                 *  It seems unlikely for 3+ retry failures even if users have millions of codes. */
                value.code = generateCode(codeParamsForRetry);
                return insertValue(auth, trx, value, codeParamsForRetry, retryCount + 1);
            } else {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with the given code already exists.`, "ValueCodeExists");
            }
        }
        if (constraint === "fk_Values_Currencies") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${value.currency}' does not exist. See the documentation on creating currencies.`, "CurrencyNotFound");
        }
        if (constraint === "fk_Values_Contacts") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact '${value.contactId}' does not exist.`, "ContactNotFound");
        }
        throw err;
    }

    return dbValue;
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

export async function insertStripeTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan, stripeConfig: LightrailAndMerchantStripeConfig): Promise<TransactionPlan> {
    await executeStripeSteps(auth, stripeConfig, plan);
    const stripeSteps = plan.steps.filter(step => step.rail === "stripe")
        .map(step => StripeTransactionPlanStep.toStripeDbTransactionStep(step as StripeTransactionPlanStep, plan, auth));
    await trx.into("StripeTransactionSteps")
        .insert(stripeSteps);
    return plan;
}

export async function insertInternalTransactionSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, plan: TransactionPlan): Promise<TransactionPlan> {
    const internalSteps = plan.steps.filter(step => step.rail === "internal")
        .map(step => InternalTransactionPlanStep.toInternalDbTransactionStep(step as InternalTransactionPlanStep, plan, auth));
    await trx.into("InternalTransactionSteps")
        .insert(internalSteps);
    return plan;
}
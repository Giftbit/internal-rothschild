import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as log from "loglevel";
import * as Stripe from "stripe";
import {CaptureRequest} from "../../../model/TransactionRequest";
import {StripeCaptureTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getDbTransaction} from "./transactions";
import {DbTransaction, LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {DbValue} from "../../../model/Value";
import {getKnexRead} from "../../../utils/dbUtils/connection";

export async function createCaptureTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CaptureRequest, transactionIdToCapture: string): Promise<TransactionPlan> {
    log.info(`Creating capture transaction plan for user: ${auth.userId} and capture request:`, req);

    const dbTransactionToCapture = await getDbTransaction(auth, transactionIdToCapture);
    const now = nowInDbPrecision();
    if (!dbTransactionToCapture.pendingVoidDate) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture a Transaction that is not pending.`, "TransactionNotPending");
    }
    if (dbTransactionToCapture.nextTransactionId) {
        let nextTransaction: DbTransaction;
        try {
            nextTransaction = await getDbTransaction(auth, dbTransactionToCapture.nextTransactionId);
        } catch (err) {
            throw new Error(`Transaction '${transactionIdToCapture}' has nextTransactionId '${dbTransactionToCapture.nextTransactionId}' that could not be retrieved for error messaging. ${err}`);
        }

        if (nextTransaction.transactionType === "capture") {
            throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Transaction has already been captured in Transaction '${dbTransactionToCapture.nextTransactionId}'.`, "TransactionCaptured");
        }
        if (nextTransaction.transactionType === "void") {
            throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Transaction has already been voided in Transaction '${dbTransactionToCapture.nextTransactionId}'.`, "TransactionVoided");
        }
        throw new Error(`Transaction '${transactionIdToCapture}' has nextTransactionId '${dbTransactionToCapture.nextTransactionId}' with unexpected transactionType '${nextTransaction.transactionType}'.`);
    }
    if (dbTransactionToCapture.pendingVoidDate < now) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture Transaction that passed the pendingVoidDate.  It is in the process of being automatically voided.`, "TransactionVoiding");
    }

    const transactionToCapture: Transaction = (await DbTransaction.toTransactions([dbTransactionToCapture], auth.userId))[0];

    const values = await getDbValuesFromTransaction(auth, transactionToCapture);
    const frozenValue = values.find(value => value.frozen);
    const canceledValue = values.find(value => value.canceled);
    if (frozenValue) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture Transaction because value. '${frozenValue.id}' is frozen.`, "ValueFrozen");
    }
    if (canceledValue) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture Transaction because value. '${canceledValue.id}' is canceled.`, "ValueCanceled");
    }

    return {
        id: req.id,
        transactionType: "capture",
        currency: transactionToCapture.currency,
        steps: getCaptureTransactionPlanSteps(req.id, transactionToCapture),
        createdDate: now,
        metadata: req.metadata,
        totals: null,
        tax: transactionToCapture.tax ? transactionToCapture.tax : null,
        pendingVoidDate: null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: transactionToCapture.id,
        previousTransactionId: transactionToCapture.id
    };
}

function getCaptureTransactionPlanSteps(captureTransactionId: string, transactionToCapture: Transaction): TransactionPlanStep[] {
    return transactionToCapture.steps
        .map((step, stepIx) => {
            if (step.rail === "stripe") {
                if (step.charge.object === "charge" && !(step.charge as Stripe.charges.ICharge).captured) {
                    const stripeCapturePlanStep: StripeCaptureTransactionPlanStep = {
                        rail: "stripe",
                        type: "capture",
                        chargeId: step.chargeId,
                        pendingAmount: step.amount,
                        amount: 0
                    };
                    return stripeCapturePlanStep;
                }
            }
            return null;
        })
        .filter(planStep => !!planStep);
}

async function getDbValuesFromTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, transaction: Transaction): Promise<DbValue[]> {
    const valueIds = transaction.steps
        .filter(step => step.rail === "lightrail")
        .map(step => (step as LightrailTransactionStep).valueId);
    if (!valueIds.length) {
        return [];
    }

    const knex = await getKnexRead();
    const dbValues: DbValue[] = await knex("Values")
        .where({userId: auth.userId})
        .whereIn("id", valueIds);
    return dbValues;
}

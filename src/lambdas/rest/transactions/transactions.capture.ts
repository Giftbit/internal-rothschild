import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as log from "loglevel";
import * as Stripe from "stripe";
import {CaptureRequest} from "../../../model/TransactionRequest";
import {StripeCaptureTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getTransactionTags, getDbTransaction} from "./transactions";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {getDbValuesByTransaction} from "../values/values";

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

    const transactionToCapture: Transaction = (await DbTransaction.toTransactionsUsingDb([dbTransactionToCapture], auth.userId))[0];

    const values = await getDbValuesByTransaction(auth, transactionToCapture);
    const frozenValue = values.find(value => value.frozen);
    if (frozenValue) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture Transaction because value '${frozenValue.id}' is frozen.`, "ValueFrozen");
    }

    const tags = getTransactionTags(values.map(v => v.contactId), transactionToCapture);

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
        previousTransactionId: transactionToCapture.id,
        tags: tags
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

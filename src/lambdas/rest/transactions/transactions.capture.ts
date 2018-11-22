import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as log from "loglevel";
import * as Stripe from "stripe";
import {CaptureRequest} from "../../../model/TransactionRequest";
import {StripeCaptureTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getDbTransaction} from "./transactions";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {DbTransaction, Transaction} from "../../../model/Transaction";

export async function createCaptureTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CaptureRequest, transactionIdToCapture: string): Promise<TransactionPlan> {
    const dbTransactionToCapture = await getDbTransaction(auth, transactionIdToCapture);
    if (!dbTransactionToCapture.pendingVoidDate) {
        log.info(`Transaction ${JSON.stringify(dbTransactionToCapture)} is not pending and cannot be captured.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture Transaction that is not pending.`, "TransactionNotCapturable");
    }
    if (dbTransactionToCapture.nextTransactionId) {
        log.info(`Transaction ${JSON.stringify(dbTransactionToCapture)} was not last in chain and cannot be captured.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot capture Transaction that is not last in the Transaction Chain. See documentation for more information on the Transaction Chain.`, "TransactionNotCapturable");
    }

    const transactionToCapture: Transaction = (await DbTransaction.toTransactions([dbTransactionToCapture], auth.userId))[0];

    const now = nowInDbPrecision();
    return {
        id: req.id,
        transactionType: "capture",
        currency: transactionToCapture.currency,
        steps: getCaptureTransactionPlanSteps(req.id, transactionToCapture),
        createdDate: now,
        metadata: req.metadata,
        totals: null,
        tax: null,
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
                        idempotentStepId: `${captureTransactionId}-${stepIx}`,
                        chargeId: step.chargeId,
                        amount: 0
                    };
                    return stripeCapturePlanStep;
                }
            }
            return null;
        })
        .filter(planStep => !!planStep);
}

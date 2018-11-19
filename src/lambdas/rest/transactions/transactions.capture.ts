import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as log from "loglevel";
import {CaptureRequest} from "../../../model/TransactionRequest";
import {TransactionPlan} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getDbTransaction} from "./transactions";
import {GiftbitRestError} from "giftbit-cassava-routes";

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

    // TODO Stripe steps will make this more complicated

    const now = nowInDbPrecision();
    return {
        id: req.id,
        transactionType: "capture",
        currency: dbTransactionToCapture.currency,
        steps: [],
        createdDate: now,
        metadata: req.metadata,
        totals: null,
        tax: null,
        pendingVoidDate: null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: dbTransactionToCapture.id,
        previousTransactionId: dbTransactionToCapture.id
    };
}

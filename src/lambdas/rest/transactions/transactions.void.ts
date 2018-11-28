import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as log from "loglevel";
import {VoidRequest} from "../../../model/TransactionRequest";
import {TransactionPlan} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getDbTransaction} from "./transactions";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {getReverseTransactionPlanSteps, invertTransactionTotals} from "./reverse/transactions.reverse";
import {DbTransaction, Transaction} from "../../../model/Transaction";

export async function createVoidTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: VoidRequest, transactionIdToVoid: string): Promise<TransactionPlan> {
    const dbTransactionToVoid = await getDbTransaction(auth, transactionIdToVoid);
    return createVoidTransactionPlanForDbTransaction(auth, req, dbTransactionToVoid);
}

export async function createVoidTransactionPlanForDbTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: VoidRequest, dbTransactionToVoid: DbTransaction): Promise<TransactionPlan> {
    if (!dbTransactionToVoid.pendingVoidDate) {
        log.info(`Transaction ${JSON.stringify(dbTransactionToVoid)} is not pending and cannot be voided.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot void Transaction that is not pending.`, "TransactionNotVoidable");
    }
    if (dbTransactionToVoid.nextTransactionId) {
        log.info(`Transaction ${JSON.stringify(dbTransactionToVoid)} was not last in chain and cannot be voided.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot void Transaction that is not last in the Transaction Chain. See documentation for more information on the Transaction Chain.`, "TransactionNotVoidable");
    }

    const transactionToVoid: Transaction = (await DbTransaction.toTransactions([dbTransactionToVoid], auth.userId))[0];

    return {
        id: req.id,
        transactionType: "void",
        currency: transactionToVoid.currency,
        steps: await getReverseTransactionPlanSteps(auth, req.id, transactionToVoid),
        totals: transactionToVoid.totals && invertTransactionTotals(transactionToVoid.totals),
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        tax: transactionToVoid.tax ? transactionToVoid.tax : null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: transactionToVoid.id,
        previousTransactionId: transactionToVoid.id
    };
}

import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as log from "loglevel";
import {VoidRequest} from "../../../model/TransactionRequest";
import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getTransactionTags, getDbTransaction} from "./transactions";
import {getReverseTransactionPlanSteps, invertTransactionTotals} from "./reverse/transactions.reverse";
import {DbTransaction, Transaction} from "../../../model/Transaction";

export async function createVoidTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: VoidRequest, transactionIdToVoid: string): Promise<TransactionPlan> {
    const dbTransactionToVoid = await getDbTransaction(auth, transactionIdToVoid);
    return createVoidTransactionPlanForDbTransaction(auth, req, dbTransactionToVoid);
}

export async function createVoidTransactionPlanForDbTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: VoidRequest, dbTransactionToVoid: DbTransaction): Promise<TransactionPlan> {
    log.info(`Creating void transaction plan for user '${auth.userId}' with void request:`, req);

    if (!dbTransactionToVoid.pendingVoidDate) {
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot void a Transaction that is not pending.`, "TransactionNotPending");
    }
    if (dbTransactionToVoid.nextTransactionId) {
        let nextTransaction: DbTransaction;
        try {
            nextTransaction = await getDbTransaction(auth, dbTransactionToVoid.nextTransactionId);
        } catch (err) {
            throw new Error(`Transaction '${dbTransactionToVoid.id}' has nextTransactionId '${dbTransactionToVoid.nextTransactionId}' that could not be retrieved for error messaging. ${err}`);
        }

        if (nextTransaction.transactionType === "capture") {
            throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Transaction has already been captured in Transaction '${dbTransactionToVoid.nextTransactionId}'.`, "TransactionCaptured");
        }
        if (nextTransaction.transactionType === "void") {
            throw new GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Transaction has already been voided in Transaction '${dbTransactionToVoid.nextTransactionId}'.`, "TransactionVoided");
        }
        throw new Error(`Transaction '${dbTransactionToVoid.id}' has nextTransactionId '${dbTransactionToVoid.nextTransactionId}' with unexpected transactionType '${nextTransaction.transactionType}'.`);
    }

    const transactionToVoid: Transaction = (await DbTransaction.toTransactionsUsingDb([dbTransactionToVoid], auth.userId))[0];
    const voidSteps = await getVoidTransactionPlanSteps(auth, req.id, transactionToVoid);
    const tags = getTransactionTags(voidSteps.filter(s => s.rail === "lightrail").map(s => (s as LightrailTransactionPlanStep).value.contactId), transactionToVoid);

    return {
        id: req.id,
        transactionType: "void",
        currency: transactionToVoid.currency,
        steps: voidSteps,
        totals: transactionToVoid.totals && invertTransactionTotals(transactionToVoid.totals),
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        tax: transactionToVoid.tax || null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: transactionToVoid.id,
        previousTransactionId: transactionToVoid.id,
        tags: tags
    };
}

async function getVoidTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, transactionId: string, transactionToVoid: Transaction): Promise<TransactionPlanStep[]> {
    // Voiding is mostly the same as reversing.
    const steps = await getReverseTransactionPlanSteps(auth, transactionId, transactionToVoid);
    steps.forEach(step => {
        if (step.rail === "lightrail" && step.action === "update") {
            step.allowFrozen = true;
            step.allowCanceled = true;
        }
        if (step.rail === "stripe" && step.type === "refund") {
            step.reason = undefined;
        }
    });
    return steps;
}

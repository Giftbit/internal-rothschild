import * as cassava from "cassava";
import * as stripe from "stripe";
import {ReverseRequest} from "../../../../model/TransactionRequest";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "../TransactionPlan";
import {
    DbTransaction,
    InternalTransactionStep,
    LightrailTransactionStep,
    StripeTransactionStep,
    Transaction
} from "../../../../model/Transaction";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {getDbTransaction} from "../transactions";
import {nowInDbPrecision} from "../../../../utils/dbUtils";
import {Value} from "../../../../model/Value";
import {getValues} from "../../values";
import log = require("loglevel");

export async function createReverseTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest, transactionIdToReverse: string): Promise<TransactionPlan> {
    log.info(`Creating reverse transaction plan for user: ${auth.userId} and reverse request: ${JSON.stringify(req)}.`);

    const dbTransactionToReverse = await getDbTransaction(auth, transactionIdToReverse);
    if (dbTransactionToReverse.nextTransactionId) {
        log.info(`Transaction ${JSON.stringify(dbTransactionToReverse)} was not last in chain and cannot be reversed.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse Transaction that is not last in the Transaction Chain. See documentation for more information on the Transaction Chain.`, "TransactionNotReversible");
    }
    if (dbTransactionToReverse.pendingVoidDate) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot reverse a pending transaction.`, "TransactionPending");
    }
    if (dbTransactionToReverse.transactionType === "reverse") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot reverse a reverse transaction.`);
    }
    if (dbTransactionToReverse.transactionType === "void") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Cannot reverse a void transaction.`);
    }

    const transactionToReverse: Transaction = (await DbTransaction.toTransactions([dbTransactionToReverse], auth.userId))[0];

    return {
        id: req.id,
        transactionType: "reverse",
        currency: transactionToReverse.currency,
        steps: await getReverseTransactionPlanSteps(auth, req.id, transactionToReverse),
        totals: transactionToReverse.totals && invertTransactionTotals(transactionToReverse.totals),
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        tax: transactionToReverse.tax ? transactionToReverse.tax : null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: transactionToReverse.id,
        previousTransactionId: transactionToReverse.id
    };
}

export async function getReverseTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, planId: string, tx: Transaction): Promise<TransactionPlanStep[]> {
    const valueIdsArrayString: string = tx.steps.filter(step => step.rail === "lightrail").map(lrStep => (lrStep as LightrailTransactionStep).valueId).join(",");
    const lrValues: Value[] = (await getValues(auth, {"id.in": valueIdsArrayString}, {
        limit: valueIdsArrayString.length,
        maxLimit: 1000,
        sort: null,
        before: null,
        after: null,
        last: false
    })).values;
    return tx.steps.map(step => {
        switch (step.rail) {
            case "lightrail":
                return getReverseForLightrailTransactionStep(auth, step, lrValues.find(v => v.id === step.valueId));
            case "stripe":
                return getReverseForStripeTransactionStep(auth, step, planId + step.chargeId, `Being refunded as part of reverse transaction ${planId}.`);
            case "internal":
                return getReverseForInternalTransactionStep(auth, step);
            default:
                throw Error(`Unexpected step rail type found in transaction for reverse. ${JSON.stringify(tx)}.`);
        }
    });
}

function getReverseForLightrailTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: LightrailTransactionStep, value: Value): LightrailTransactionPlanStep {
    if (!value) {
        throw new Error(`No value found with id ${step.valueId} and user ${auth.userId}. This is a serious problem since step ${JSON.stringify(step)} claims one exists.`);
    }
    return {
        rail: "lightrail",
        value: value,
        amount: -step.balanceChange,
        uses: -step.usesRemainingChange
    };
}

function getReverseForStripeTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeTransactionStep, idempotentStepId: string, refundReason: string): StripeTransactionPlanStep {
    return {
        rail: "stripe",
        type: "refund",
        idempotentStepId: idempotentStepId,
        chargeId: step.chargeId,
        amount: -step.amount,
        reason: refundReason
    };
}

function getReverseForInternalTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: InternalTransactionStep): InternalTransactionPlanStep {
    return {
        rail: "internal",
        internalId: step.internalId,
        balance: step.balanceAfter,
        pretax: null,
        beforeLightrail: null,
        amount: -step.balanceChange
    };
}

export function invertTransactionTotals<T extends object>(t: T): T {
    const res: T = Object.assign({}, t);
    for (const key in res) {
        if (typeof res[key] === "number") {
            res[key] = -res[key] as any;
        } else if (res[key] && typeof res[key] === "object") {
            res[key] = invertTransactionTotals(res[key] as any) as any;
        }
    }
    return res;
}

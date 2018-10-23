import {ReverseRequest} from "../../../../model/TransactionRequest";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
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
import * as cassava from "cassava";
import * as stripe from "stripe";
import {Value} from "../../../../model/Value";
import {getValues} from "../../values";
import log = require("loglevel");

export async function createReverseTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest, transactionIdToReverse: string): Promise<TransactionPlan> {
    log.info(`Creating reverse transaction plan for user: ${auth.userId} and reverse request: ${JSON.stringify(req)}.`);

    const dbTransactionToReverse = await getDbTransaction(auth, transactionIdToReverse);
    if (dbTransactionToReverse.nextTransactionId) {
        log.info(`Transaction ${JSON.stringify(dbTransactionToReverse)} was not last in chain and cannot be reversed.`);
        throw new GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse transaction that is not last in the transaction chain. Use endpoint .../v2/transactions/${transactionIdToReverse}/chain to find last transaction in chain.`, "TransactionNotReversible");
    }
    const transactionToReverse: Transaction = (await DbTransaction.toTransactions([dbTransactionToReverse], auth.userId))[0];

    if (transactionToReverse.transactionType === "reverse") {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse a reverse transaction.`);
    }

    const plan: TransactionPlan = {
        id: req.id,
        transactionType: "reverse",
        currency: transactionToReverse.currency,
        steps: [],
        totals: transactionToReverse.totals ? invertNumbers(transactionToReverse.totals) : null,
        createdDate: nowInDbPrecision(),
        metadata: transactionToReverse.metadata,
        tax: transactionToReverse.tax ? transactionToReverse.tax : null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: transactionToReverse.id,
        previousTransactionId: transactionToReverse.id
    };

    const valueIdsArrayString: string = transactionToReverse.steps.filter(step => step.rail === "lightrail").map(lrStep => (lrStep as LightrailTransactionStep).valueId).join(",");
    const lrValues: Value[] = (await getValues(auth, {"id.in": valueIdsArrayString}, {
        limit: valueIdsArrayString.length,
        maxLimit: 1000,
        sort: null,
        before: null,
        after: null,
        last: false
    })).values;
    plan.steps = transactionToReverse.steps.map(step => {
        switch (step.rail) {
            case "lightrail":
                return getReverseForLightrailTransactionStep(auth, step, lrValues.find(v => v.id === step.valueId));
            case "stripe":
                return getReverseForStripeTransactionStep(auth, step, plan.id + step.chargeId, `Being refunded as part of reverse transaction ${plan.id}.`);
            case "internal":
                return getReverseForInternalTransactionStep(auth, step);
            default:
                throw Error(`Unexpected step rail type found in transaction for reverse. ${transactionToReverse}.`);
        }
    });
    log.info("Reverse plan: " + JSON.stringify(plan, null, 4));
    return plan;
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

function getReverseForStripeTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeTransactionStep, idempotentStepId: string, refundMetadataReason: string): StripeTransactionPlanStep {
    return {
        rail: "stripe",
        type: "refund",
        idempotentStepId: idempotentStepId,
        chargeId: step.chargeId,
        amount: -step.amount,
        reason: refundMetadataReason
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

function invertNumbers<T extends object>(t: T): T {
    const res: T = Object.assign({}, t);
    for (const key in res) {
        if (typeof res[key] === "number") {
            res[key] = -res[key] as any;
        } else if (res[key] && typeof res[key] === "object") {
            res[key] = invertNumbers(res[key] as any) as any;
        }
    }
    return res;
}
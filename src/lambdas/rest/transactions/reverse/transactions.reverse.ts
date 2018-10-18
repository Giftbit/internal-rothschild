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
    Transaction,
    TransactionTotals,
    TransactionType
} from "../../../../model/Transaction";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getDbTransaction} from "../transactions";
import {nowInDbPrecision} from "../../../../utils/dbUtils/index";
import {getValue} from "../../values";
import * as cassava from "cassava";
import * as stripe from "stripe";
import log = require("loglevel");

export async function createReverseTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest): Promise<TransactionPlan> {
    log.info(`Creating reverse transaction plan for user: ${auth.userId} and reverse request: ${JSON.stringify(req)}.`);

    const dbTransaction = await getDbTransaction(auth, req.transactionIdToReverse);
    if (dbTransaction.nextTransactionId) {
        log.info(`Transaction ${JSON.stringify(dbTransaction)} was not last in chain and cannot be reversed.`);
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse transaction that is not last in the transaction chain. Use endpoint .../v2/transactions/${req.transactionIdToReverse}/chain to find last transaction in chain.`);
    }
    const transactionToReverse: Transaction = (await DbTransaction.toTransactions([dbTransaction], auth.userId))[0];

    if (transactionToReverse.transactionType === "reverse") {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse a reverse transaction.`);
    }

    const plan: TransactionPlan = {
        id: req.id,
        transactionType: "reverse" as TransactionType,
        currency: transactionToReverse.currency,
        steps: [],
        totals: transactionToReverse.totals ? reverseTotals(transactionToReverse.totals) : null,
        createdDate: nowInDbPrecision(),
        metadata: transactionToReverse.metadata,
        tax: transactionToReverse.tax ? transactionToReverse.tax : null,
        lineItems: null,
        paymentSources: null,
        rootTransactionId: transactionToReverse.id,
        previousTransactionId: transactionToReverse.id
    };

    for (const step of transactionToReverse.steps) {
        switch (step.rail) {
            case "lightrail":
                plan.steps.push(await getReverseForLightrailTransactionStep(auth, step));
                break;
            case "stripe":
                const stripeStepNumber = plan.steps.filter(step => step.rail === "stripe").length;
                plan.steps.push(await getReverseForStripeTransactionStep(auth, step, `${plan.id}-${stripeStepNumber}`, `Being refunded as part of reverse transaction ${plan.id}.`));
                break;
            case "internal":
                plan.steps.push(await getReverseForInternalTransactionStep(auth, step));
                break;
            default:
                throw Error(`Unexpected step rail type found in transaction for reverse. ${transactionToReverse}.`)
        }
    }
    log.info("Reverse plan: " + JSON.stringify(plan, null, 4));
    return plan;
}

async function getReverseForLightrailTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: LightrailTransactionStep): Promise<LightrailTransactionPlanStep> {
    return {
        rail: "lightrail",
        value: await getValue(auth, step.valueId),
        amount: -step.balanceChange,
        uses: -step.usesRemainingChange
    }
}

async function getReverseForStripeTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeTransactionStep, idempotentStepId: string, refundMetadataReason: string): Promise<StripeTransactionPlanStep> {
    return {
        rail: "stripe",
        type: "refund",
        idempotentStepId: idempotentStepId,
        chargeId: step.chargeId,
        amount: -step.amount, // step.amount is a negative for a charge
        reason: refundMetadataReason
    }
}

async function getReverseForInternalTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: InternalTransactionStep): Promise<InternalTransactionPlanStep> {
    return {
        rail: "internal",
        internalId: step.internalId,
        balance: step.balanceAfter,
        pretax: null,
        beforeLightrail: null,
        amount: -step.balanceChange
    }
}

// todo - there must be a more elegant way to do this.
function reverseTotals(totals: TransactionTotals): TransactionTotals {
    return {
        subtotal: totals.subtotal != null ? -totals.subtotal : totals.subtotal,
        tax: totals.tax != null ? -totals.tax : totals.tax,
        discountLightrail: totals.discountLightrail != null ? -totals.discountLightrail : totals.discountLightrail,
        paidLightrail: totals.paidLightrail != null ? -totals.paidLightrail : totals.paidLightrail,
        paidStripe: totals.paidStripe != null ? -totals.paidStripe : totals.paidStripe,
        paidInternal: totals.paidInternal != null ? -totals.paidInternal : totals.paidInternal,
        remainder: totals.remainder != null ? -totals.remainder : totals.remainder,
        discount: totals.discount != null ? -totals.discount : totals.discount,
        payable: totals.payable != null ? -totals.payable : totals.payable,
        marketplace: totals.marketplace != null ? {
            sellerGross: totals.marketplace.sellerGross != null ? -totals.marketplace.sellerGross : totals.marketplace.sellerGross,
            sellerDiscount: totals.marketplace.sellerDiscount != null ? -totals.marketplace.sellerDiscount : totals.marketplace.sellerDiscount,
            sellerNet: totals.marketplace.sellerNet != null ? -totals.marketplace.sellerNet : totals.marketplace.sellerNet
        } : totals.marketplace
    }
}

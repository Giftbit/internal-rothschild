import {ReverseRequest} from "../../../model/TransactionRequest";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";
import {LightrailTransactionStep, Transaction, TransactionTotals, TransactionType} from "../../../model/Transaction";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getTransaction} from "./transactions";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getValue} from "../values";

export interface ReverseTransactionSteps {
    lightrailTransactionSteps: LightrailTransactionPlanStep[];
    internalTransactionSteps: InternalTransactionPlanStep[];
    stripeTransactionSteps: LightrailTransactionPlanStep[];
}

export async function resolveReverseTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest): Promise<ReverseTransactionSteps> {
    return null;
}

export async function createReverseTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest): Promise<TransactionPlan> {
    console.log("Here. " + req.transactionIdToReverse);
    const transactionToReverse: Transaction = await getTransaction(auth, req.transactionIdToReverse);
    console.log("found tx.");

    if (transactionToReverse.nextChainTransactionId) {
        // flip out
    }

    const plan: TransactionPlan = {
        id: req.id,
        transactionType: "reverse" as TransactionType,
        currency: transactionToReverse.currency,
        steps: [],
        totals: transactionToReverse.totals ? reverseTotals(transactionToReverse.totals) : null,
        createdDate: nowInDbPrecision(),
        metadata: transactionToReverse.metadata,
        tax: transactionToReverse.tax ? transactionToReverse.tax : undefined,
        lineItems: null, // seems like a duplication of information to copy lineItems over.
        paymentSources: null
    };

    for (const step of transactionToReverse.steps) {
        switch (step.rail) {
            case "lightrail":
                plan.steps.push(await getReverseForLightrailTransactionStep(auth, step));
                break;
        }


    }
    return plan;
}

async function getReverseForLightrailTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: LightrailTransactionStep): Promise<TransactionPlanStep> {
    return {
        rail: "lightrail",
        value: await getValue(auth, step.valueId),
        amount: -step.balanceChange,
        uses: -step.usesRemainingChange
    }
}

// todo - there's gotta be a more elegant way to do this.
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

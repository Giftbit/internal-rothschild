import {ReverseRequest} from "../../../model/TransactionRequest";
import {
    InternalTransactionPlanStep,
    LightrailTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";
import {
    LightrailTransactionStep,
    StripeTransactionStep,
    Transaction,
    TransactionTotals,
    TransactionType
} from "../../../model/Transaction";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getTransaction} from "./transactions";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {getValue} from "../values";
import * as cassava from "cassava";
import * as stripe from "stripe";

export interface ReverseTransactionSteps {
    lightrailTransactionSteps: LightrailTransactionPlanStep[];
    internalTransactionSteps: InternalTransactionPlanStep[];
    stripeTransactionSteps: LightrailTransactionPlanStep[];
}


/**
 * I'm not super happy with a few things.
 *  - The id. Why not just hash the original? This would give better confidence around idempotency. With this, all you'd need is to set the rootTransactionId. ()
 */
export async function createReverseTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: ReverseRequest): Promise<TransactionPlan> {
    const transactionToReverse: Transaction = await getTransaction(auth, req.transactionIdToReverse);

    if (transactionToReverse.nextChainTransactionId) {
        // flip out
    }
    // todo - What happens if trying to reverse a pending_capture or a pending_void? Can you re-capture or re-void the original tx?
    // todo - What happens if trying to reverse an attach transaction? Does it unattach the contact? What happens to the created Value if the original code was GENERIC?
    // todo - Is is just checkout that needs to be reversable? Everything else has pretty obvious workarounds.
    if (transactionToReverse.transactionType === "pending_create") {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse a pending transaction. Use void instead.`);
    }
    if (transactionToReverse.transactionType === "reverse") {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Cannot reverse a pending transaction. Use void instead.`);
    }


    /*
        initialBalance
        attach
        credit
        debit
        checkout
        transfer
        pending_create
        pending_capture
        pending_void
        reverse
     */

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
            case "stripe":
                const stripeStepNumber = plan.steps.filter(step => step.rail === "stripe").length;
                plan.steps.push(await getReverseForStripeTransactionStep(auth, step, `${plan.id}-${stripeStepNumber}`,));
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

async function getReverseForStripeTransactionStep(auth: giftbitRoutes.jwtauth.AuthorizationBadge, step: StripeTransactionStep, idempotentStepId: string): Promise<TransactionPlanStep> {
    return {
        rail: "stripe",
        type: "refund",
        idempotentStepId: idempotentStepId,
        chargeId: step.chargeId,
        amount: -step.amount, // step.amount is a negative for a charge
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

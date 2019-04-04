import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import {resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";
import {TransferRequest} from "../../../model/TransactionRequest";
import {
    LightrailTransactionPlanStep,
    StripeChargeTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan
} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {TransactionType} from "../../../model/Transaction";

export interface TransferTransactionSteps {
    sourceStep: LightrailTransactionPlanStep | StripeTransactionPlanStep;
    destStep: LightrailTransactionPlanStep;
}

export async function resolveTransferTransactionPlanSteps(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: TransferRequest): Promise<TransferTransactionSteps> {
    const sourceSteps = (await resolveTransactionPlanSteps(auth, {
        currency: req.currency,
        parties: [req.source],
        transactionId: req.id,
        nonTransactableHandling: "error",
        includeZeroBalance: true,
        includeZeroUsesRemaining: true
    })).transactionSteps;
    if (sourceSteps.length !== 1 || (sourceSteps[0].rail !== "lightrail" && sourceSteps[0].rail !== "stripe")) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the source to a transactable Value.", "InvalidParty");
    }
    const sourceStep = sourceSteps[0] as LightrailTransactionPlanStep | StripeChargeTransactionPlanStep;
    if (sourceStep.rail === "stripe" && !req.allowRemainder && sourceStep.maxAmount != null && sourceStep.maxAmount < req.amount) {
        throw new giftbitRoutes.GiftbitRestError(409, `Stripe source 'maxAmount' of ${sourceStep.maxAmount} is less than transfer amount ${req.amount}.`);
    }

    const destSteps = (await resolveTransactionPlanSteps(auth, {
        currency: req.currency,
        parties: [req.destination],
        transactionId: req.id,
        nonTransactableHandling: "error",
        includeZeroBalance: true,
        includeZeroUsesRemaining: true
    })).transactionSteps;
    if (destSteps.length !== 1 || destSteps[0].rail !== "lightrail") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the destination to a transactable Value.", "InvalidParty");
    }
    const destStep = destSteps[0] as LightrailTransactionPlanStep;

    return {sourceStep, destStep};
}

export function createTransferTransactionPlan(req: TransferRequest, steps: TransferTransactionSteps): TransactionPlan {
    const plan: TransactionPlan = {
        id: req.id,
        transactionType: "transfer" as TransactionType,
        currency: req.currency,
        steps: [
            steps.sourceStep,
            steps.destStep
        ],
        totals: {
            remainder: 0
        },
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        tax: null,
        lineItems: null,
        paymentSources: null
    };

    if (steps.sourceStep.rail === "lightrail") {
        const amount = Math.min(req.amount, steps.sourceStep.value.balance);

        steps.sourceStep.amount = -amount;
        steps.destStep.amount = amount;
        plan.totals.remainder = req.amount - amount;
    } else if (steps.sourceStep.rail === "stripe") {
        steps.sourceStep = steps.sourceStep as StripeChargeTransactionPlanStep;
        const amount = steps.sourceStep.maxAmount != null ? (Math.min(steps.sourceStep.maxAmount, req.amount)) : req.amount;

        steps.sourceStep.amount = -amount;
        steps.sourceStep.idempotentStepId = `${req.id}-src`;
        steps.destStep.amount = amount;
        plan.totals.remainder = steps.sourceStep.maxAmount ? Math.max(req.amount - steps.sourceStep.maxAmount, 0) : 0;
    }

    return plan;
}

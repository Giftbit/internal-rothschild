import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as pendingTransactionUtils from "./pendingTransactionUtils";
import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {DebitRequest} from "../../../model/TransactionRequest";

export async function createDebitTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: DebitRequest): Promise<TransactionPlan> {
    const steps = (await resolveTransactionPlanSteps(auth, {
        currency: req.currency,
        parties: [req.source],
        transactionId: req.id,
        nonTransactableHandling: "error",
        includeZeroBalance: true,
        includeZeroUsesRemaining: true
    })).transactionSteps;
    if (steps.length !== 1 || steps[0].rail !== "lightrail") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the source to a transactable Value.", "InvalidParty");
    }

    const step = steps[0] as LightrailTransactionPlanStep;
    if (req.amount && step.value.balance == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot debit amount from a Value with balance=null.", "NullBalance");
    }
    if (req.uses && step.value.usesRemaining == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot debit uses from a Value with usesRemaining=null.", "NullUses");
    }
    if (req.uses && req.allowRemainder !== true && req.uses > step.value.usesRemaining) {
        throw new giftbitRoutes.GiftbitRestError(409, "Insufficient uses for the transaction.", "InsufficientUses");
    }

    const now = nowInDbPrecision();
    const amount = req.amount != null ? Math.min(req.amount, step.value.balance) : null;
    const uses = req.uses != null ? Math.min(req.uses, step.value.usesRemaining) : null;

    step.amount = amount && -amount;
    step.uses = uses && -uses;

    return {
        id: req.id,
        transactionType: "debit",
        currency: req.currency,
        steps: [step],
        createdDate: now,
        metadata: req.metadata,
        totals: {
            remainder: (req.amount || 0) - (amount || 0)
        },
        tax: null,
        pendingVoidDate: pendingTransactionUtils.getPendingVoidDate(req, now),
        lineItems: null,
        paymentSources: null
    };
}

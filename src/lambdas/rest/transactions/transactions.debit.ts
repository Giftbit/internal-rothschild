import * as giftbitRoutes from "giftbit-cassava-routes";
import {DebitRequest} from "../../../model/TransactionRequest";
import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";
import * as cassava from "cassava";
import {nowInDbPrecision} from "../../../utils/dbUtils";

export async function createDebitTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: DebitRequest): Promise<TransactionPlan> {
    const steps = await resolveTransactionPlanSteps(auth, {
        currency: req.currency,
        parties: [req.source],
        transactionId: req.id,
        nonTransactableHandling: "error",
        acceptZeroBalance: true,
        acceptZeroUses: true
    });
    if (steps.length !== 1 || steps[0].rail !== "lightrail") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the source to a transactable Value.", "InvalidParty");
    }

    const step = steps[0] as LightrailTransactionPlanStep;
    if (req.amount && step.value.balance == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot debit amount from a Value with balance=null.", "NullBalance");
    }
    if (req.uses && step.value.uses == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot debit uses from a Value with uses=null.", "NullUses");
    }
    if (req.uses && req.allowRemainder !== true && req.uses > step.value.usesRemaining) {
        throw new giftbitRoutes.GiftbitRestError(409, "Insufficient uses for the transaction.", "InsufficientUses");
    }

    const amount = req.amount != null ? Math.min(req.amount, step.value.balance) : null;
    const uses = req.uses != null ? Math.min(req.uses, step.value.usesRemaining) : null;

    step.amount = amount && -amount;
    step.uses = uses && -uses;

    return {
        id: req.id,
        transactionType: "debit",
        currency: req.currency,
        steps: [step],
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        totals: {
            remainder: (req.amount || 0) - (amount || 0)
        },
        tax: null,
        lineItems: null,
        paymentSources: null
    };
}

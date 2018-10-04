import {LightrailTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import {resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import {CreditRequest} from "../../../model/TransactionRequest";
import {nowInDbPrecision} from "../../../utils/dbUtils";

export async function createCreditTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CreditRequest): Promise<TransactionPlan> {
    const steps = await resolveTransactionPlanSteps(auth, {
        currency: req.currency,
        parties: [req.destination],
        transactionId: req.id,
        nonTransactableHandling: "error",
        acceptZeroBalance: true,
        acceptZeroUses: true
    });
    if (steps.length !== 1 || steps[0].rail !== "lightrail") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the destination to a transactable Value.", "InvalidParty");
    }

    const step = steps[0] as LightrailTransactionPlanStep;
    if (req.amount && step.value.balance == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot credit amount to a Value with balance=null.", "NullBalance");
    }
    if (req.uses && step.value.uses == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot credit uses to a Value with uses=null.", "NullUses");
    }

    step.amount = req.amount || 0;
    step.uses = req.uses != null ? req.uses : null;

    return {
        id: req.id,
        transactionType: "credit",
        currency: req.currency,
        steps: [step],
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        totals: null,
        tax: null,
        lineItems: null,
        paymentSources: null
    };
}

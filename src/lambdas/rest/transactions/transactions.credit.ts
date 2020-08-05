import {LightrailUpdateTransactionPlanStep, TransactionPlan} from "./TransactionPlan";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import {CreditRequest} from "../../../model/TransactionRequest";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {formatContactIdTags} from "./transactions";
import {resolveTransactionPlanSteps} from "./resolveTransactionPlanSteps";

export async function createCreditTransactionPlan(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: CreditRequest): Promise<TransactionPlan> {
    const steps = await resolveTransactionPlanSteps(auth, [req.destination], {
        currency: req.currency?.toUpperCase(),
        transactionId: req.id,
        nonTransactableHandling: "error",
        includeZeroBalance: true,
        includeZeroUsesRemaining: true
    });
    if (steps.length !== 1 || steps[0].rail !== "lightrail") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the destination to a transactable Value.", "InvalidParty");
    }

    const step = steps[0] as LightrailUpdateTransactionPlanStep;
    if (req.amount && step.value.balance == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot credit amount to a Value with balance=null.", "NullBalance");
    }
    if (req.uses && step.value.usesRemaining == null) {
        throw new giftbitRoutes.GiftbitRestError(409, "Cannot credit uses to a Value with usesRemaining=null.", "NullUses");
    }

    step.amount = req.amount || null;
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
        paymentSources: null,
        tags: formatContactIdTags([step.value.contactId])
    };
}

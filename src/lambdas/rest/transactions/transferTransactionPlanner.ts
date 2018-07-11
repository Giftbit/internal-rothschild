import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import {resolveTransactionParties} from "./resolveTransactionParties";
import {StripeTransactionParty, TransferRequest} from "../../../model/TransactionRequest";
import {
    LightrailTransactionPlanStep,
    StripeTransactionPlanStep,
    TransactionPlan,
    TransactionPlanStep
} from "./TransactionPlan";
import {nowInDbPrecision} from "../../../utils/dbUtils";


export async function resolveTransferTransactionParties(auth: giftbitRoutes.jwtauth.AuthorizationBadge, req: TransferRequest) {
    const sourceParties = await resolveTransactionParties(auth, req.currency, [req.source], req.id);
    if (sourceParties.length !== 1 || (sourceParties[0].rail !== "lightrail" && sourceParties[0].rail !== "stripe")) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the source to a transactable Value.", "InvalidParty");
    }
    if (sourceParties[0].rail === "stripe" && !req.allowRemainder && (sourceParties[0] as StripeTransactionParty).maxAmount && (sourceParties[0] as StripeTransactionParty).maxAmount < req.amount) {
        throw new giftbitRoutes.GiftbitRestError(409, `Stripe source 'maxAmount' of ${(sourceParties[0] as StripeTransactionParty).maxAmount} is less than transfer amount ${req.amount}.`);
    }

    const destParties = await resolveTransactionParties(auth, req.currency, [req.destination], req.id);
    if (destParties.length !== 1 || destParties[0].rail !== "lightrail") {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, "Could not resolve the destination to a transactable Value.", "InvalidParty");
    }

    return {sourceParties, destParties};
}

export async function createTransferTransactionPlan(req: TransferRequest, parties: { sourceParties: TransactionPlanStep[], destParties: TransactionPlanStep[] }) {
    let plan = {
        id: req.id,
        transactionType: "transfer",
        currency: req.currency,
        steps: null,
        totals: null,
        createdDate: nowInDbPrecision(),
        metadata: req.metadata,
        lineItems: null,
        paymentSources: null
    };

    if (parties.sourceParties[0].rail === "lightrail") {
        const amount = Math.min(req.amount, (parties.sourceParties[0] as LightrailTransactionPlanStep).value.balance);

        return ({
            ...plan,
            steps: [
                {
                    rail: "lightrail",
                    value: (parties.sourceParties[0] as LightrailTransactionPlanStep).value,
                    amount: -amount
                },
                {
                    rail: "lightrail",
                    value: (parties.destParties[0] as LightrailTransactionPlanStep).value,
                    amount: amount
                }
            ],
            totals: {
                remainder: req.amount - amount
            }
        } as TransactionPlan);  // casting: otherwise throws "Type 'string' is not assignable to type 'TransactionType'."

    } else if (parties.sourceParties[0].rail === "stripe") {
        const party = parties.sourceParties[0] as StripeTransactionParty;
        const maxAmount = (parties.sourceParties[0] as StripeTransactionPlanStep).maxAmount || null;
        const amount = maxAmount ? (Math.min(maxAmount, req.amount)) : req.amount;

        return ({
            ...plan,
            steps: [
                {
                    rail: parties.sourceParties[0].rail,
                    source: party.source || null,
                    customer: party.customer || null,
                    amount,
                    idempotentStepId: `${req.id}-transfer-source`,
                    maxAmount: maxAmount ? maxAmount : null
                },
                {
                    rail: "lightrail",
                    value: (parties.destParties[0] as LightrailTransactionPlanStep).value,
                    amount
                }
            ],
            totals: {
                remainder: party.maxAmount ? Math.max(req.amount - party.maxAmount, 0) : 0
            }
        } as TransactionPlan);  // casting: otherwise throws "Type 'string' is not assignable to type 'TransactionType'."
    }
}

import * as stripe from "stripe";
import {ValueStore} from "../../../model/ValueStore";
import {TransactionTotal, TransactionType} from "../../../model/Transaction";
import {LineItemResponse} from "../../../model/LineItem";

export interface TransactionPlan {
    transactionId: string;
    transactionType: TransactionType;
    totals?: TransactionTotal;
    lineItems?: LineItemResponse[];
    steps: TransactionPlanStep[];
    remainder: number;
}

export function calculateRemainder(lineItems: LineItemResponse[]) {
    let remainder = 0;
    for (const item of lineItems) {
        remainder += item.lineTotal.remainder;
    }
    return remainder;
}

export type TransactionPlanStep =
    LightrailTransactionPlanStep
    | StripeTransactionPlanStep
    | InternalTransactionPlanStep;

export interface LightrailTransactionPlanStep {
    rail: "lightrail";
    valueStore: ValueStore;
    codeLastFour: string | null;
    customerId: string | null;
    amount: number;
}

export interface StripeTransactionPlanStep {
    rail: "stripe";
    token: string;
    stripeSecretKey: string;
    priority: number;
    maxAmount: number | null;
    amount: number;

    /**
     * Result of creating the charge in Stripe is only set if the plan is executed.
     */
    chargeResult?: stripe.charges.ICharge;
}

export interface InternalTransactionPlanStep {
    rail: "internal";
    internalId: string;
    value: number;
    pretax: boolean;
    beforeLightrail: boolean;
    amount: number;
}

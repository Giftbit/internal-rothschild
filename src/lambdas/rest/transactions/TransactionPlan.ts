import * as stripe from "stripe";
import {TransactionPlanTotals, TransactionType} from "../../../model/Transaction";
import {Value} from "../../../model/Value";
import {LineItemResponse} from "../../../model/LineItem";
import {TransactionParty} from "../../../model/TransactionRequest";

export interface TransactionPlan {
    id: string;
    transactionType: TransactionType;
    currency: string;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[] | null;
    paymentSources: TransactionParty[] | null;
    steps: TransactionPlanStep[];
    createdDate: Date;
    metadata: object | null;
}

export type TransactionPlanStep =
    LightrailTransactionPlanStep
    | StripeTransactionPlanStep
    | InternalTransactionPlanStep;

export interface LightrailTransactionPlanStep {
    rail: "lightrail";
    value: Value;
    amount: number;
}

export interface StripeTransactionPlanStep {
    rail: "stripe";
    source?: string;
    customer?: string;
    // stripeSecretKey: string;
    // stripeMerchantAccountId: string;
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
    balance: number;
    pretax: boolean;
    beforeLightrail: boolean;
    amount: number;
}
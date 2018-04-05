import {ValueStore} from "../../../model/ValueStore";
import {CartTransaction, TransactionType} from "../../../model/Transaction";

export interface TransactionPlan {
    transactionId: string;
    transactionType: TransactionType;
    cart?: CartTransaction;
    steps: TransactionPlanStep[];
    remainder: number;
}

export type TransactionPlanStep = LightrailTransactionPlanStep | StripeTransactionPlanStep | InternalTransactionPlanStep;

export interface LightrailTransactionPlanStep {
    rail: "lightrail";
    valueStore: ValueStore;
    amount: number;
}

export interface StripeTransactionPlanStep {
    rail: "stripe";
    token: string;
    stripeSecretKey: string;
    priority: number;
    maxAmount: number | null;
    amount: number;
}

export interface InternalTransactionPlanStep {
    rail: "internal";
    internalId: string;
    value: number;
    appliedFirst: boolean;
    amount: number;
}

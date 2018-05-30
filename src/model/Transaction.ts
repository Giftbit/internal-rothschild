import * as stripe from "stripe";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    cart?: CartTransaction;
    steps: TransactionStep[];
    remainder: number;
    simulated?: true;
    // createdDate: Date;   // TODO
    // metadata: object | null; // TODO
}

export type TransactionType = "credit" | "debit" | "order" | "transfer" | "pending_create" | "pending_capture" | "pending_void";

export type CartTransaction = any;  // Cart + explanation of what happened

export type TransactionStep = LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep;

export interface LightrailTransactionStep {
    rail: "lightrail";
    valueId: string;
    currency: string;
    contactId?: string;
    codeLastFour?: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

export interface StripeTransactionStep {
    rail: "stripe";
    amount: number;
    chargeId?: string;
    charge?: stripe.charges.ICharge;
}

export interface InternalTransactionStep {
    rail: "internal";
    id: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

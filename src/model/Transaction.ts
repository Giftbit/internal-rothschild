import * as stripe from "stripe";
import {LineItem} from "./LineItem";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    steps: TransactionStep[];
    remainder: number;
    totals?: TransactionTotal;
    lineItems?: LineItem[];
    paymentSources?: PaymentSource[];
    simulated?: true;
    metadata?: any;
}

export type PaymentSource =
    LightrailCustomerPaymentSource
    | LightrailCodePaymentSource
    | LightrailValueStorePaymentSource;

export interface LightrailCustomerPaymentSource {
    rail: "lightrail";
    customerId: string;
}

export interface LightrailCodePaymentSource {
    rail: "lightrail";
    code: string;
}

export interface LightrailValueStorePaymentSource {
    rail: "lightrail";
    valueStoreId: string;
}

export type TransactionType =
    "credit"
    | "debit"
    | "order"
    | "transfer"
    | "pending_create"
    | "pending_capture"
    | "pending_void";

export type TransactionStep = LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep;

export interface LightrailTransactionStep {
    rail: "lightrail";
    valueId: string;
    currency: string;
    contactId?: string;
    code?: string;
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

export interface TransactionTotal {
    subTotal: number;
    tax: number;
    discount: number;
    payable: number;
}
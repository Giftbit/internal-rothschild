import * as stripe from "stripe";
import {LineItem} from "./LineItem";

export interface Transaction {
    transactionId: string;
    transactionType: TransactionType;
    lineItems?: LineItem[];
    steps: TransactionStep[];
    remainder: number;
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
    valueStoreId: string;
    valueStoreType: string;
    currency: string;
    customerId?: string;
    codeLastFour?: string;
    valueBefore: number;
    valueAfter: number;
    valueChange: number;
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
    valueBefore: number;
    valueAfter: number;
    valueChange: number;
}

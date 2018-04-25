import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface Transaction {
    transactionId: string;
    transactionType: TransactionType;
    cart?: CartTransaction;
    steps: TransactionStep[];
    remainder: number;
    simulated?: true;
    createdDate: Date;
    // metadata: object | null; // TODO
}

export namespace Transaction {
    export function toDbTransaction
    (auth: giftbitRoutes.jwtauth.AuthorizationBadge, t: Transaction): DbTransaction {
        return {
            userId: auth.giftbitUserId,
            transactionId: t.transactionId,
            transactionType: t.transactionType,
            cart: JSON.stringify(t.cart),
            requestedPaymentSources: "", // todo maybe JSON.stringify(t.requestedPaymentSources), // TODO does this actually exist on the Transaction in any form, or does it only exist on the request? Depends on how we handle payment sources that evaluate to $0 (save & return, or not).
            remainder: t.remainder,
            createdDate: t.createdDate
        };
    }
}

export interface DbTransaction {
    userId: string;
    transactionId: string;
    transactionType: TransactionType;
    cart: string | null;
    requestedPaymentSources: string | null;
    remainder: number;
    createdDate: Date;
}

export namespace DbTransaction {
    export function toTransaction(t: DbTransaction): Transaction {
        return {
            transactionId: t.transactionId,
            transactionType: t.transactionType,
            cart: t.cart,
            steps: null, // TODO
            remainder: t.remainder,
            createdDate: t.createdDate
        };
    }
}

export type TransactionType =
    "credit"
    | "debit"
    | "order"
    | "transfer"
    | "pending_create"
    | "pending_capture"
    | "pending_void";

export type CartTransaction = any;  // Cart + explanation of what happened

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

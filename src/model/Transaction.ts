import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../dbUtils/connection";
import {LineItem} from "./LineItem";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    steps: TransactionStep[];
    // remainder: number;
    totals: TransactionTotal;
    lineItems?: LineItem[];
    paymentSources?: PaymentSource[];
    simulated?: true;
    createdDate: Date;
    metadata?: object | null;
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

export namespace Transaction {
    export function toDbTransaction
    (auth: giftbitRoutes.jwtauth.AuthorizationBadge, t: Transaction): DbTransaction {
        return {
            userId: auth.giftbitUserId,
            id: t.id,
            transactionType: t.transactionType,
            cart: JSON.stringify(t.cart),
            requestedPaymentSources: "", // todo JSON.stringify(t.requestedPaymentSources)
            remainder: t.remainder,
            createdDate: t.createdDate,
            metadata: JSON.stringify(t.metadata)
        };
    }
}

export interface DbTransaction {
    userId: string;
    id: string;
    transactionType: TransactionType;
    cart: string | null;
    requestedPaymentSources: string | null;
    remainder: number;
    createdDate: Date;
    metadata: string | null;
}

export namespace DbTransaction {
    export async function toTransactions(txns: DbTransaction[], userId: string): Promise<Transaction[]> {
        const knex = await getKnexRead();
        let txIds: string[] = txns.map(tx => tx.id);
        let dbSteps: any[] = await knex("LightrailTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds);
        dbSteps = dbSteps.concat(await knex("StripeTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds));
        dbSteps = dbSteps.concat(await knex("InternalTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds));

        return txns.map(t => {
            return {
                id: t.id,
                transactionType: t.transactionType,
                cart: t.cart,
                steps: dbSteps.filter(step => step.transactionId === t.id),
                remainder: t.remainder,
                createdDate: t.createdDate,
                metadata: JSON.parse(t.metadata)
            };
        });
    }
}

export type TransactionType = "credit" | "debit" | "order" | "transfer" | "pending_create" | "pending_capture" | "pending_void";

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
    subTotal?: number;
    tax?: number;
    discount?: number;
    payable?: number;
    remainder: number;
}
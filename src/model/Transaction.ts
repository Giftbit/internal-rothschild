import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../dbUtils/connection";
import {LineItem} from "./LineItem";
import {TransactionParty} from "./TransactionRequest";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    steps: TransactionStep[];
    totals: TransactionTotal;
    lineItems?: LineItem[];
    paymentSources: TransactionParty[] | null;
    simulated?: true;
    createdDate: Date;
    metadata?: object | null;
}

export interface DbTransaction {
    userId: string;
    id: string;
    transactionType: TransactionType;
    totals: string | null;
    lineItems: string | null;
    paymentSources: string | null;
    createdDate: Date;
    metadata: string | null;
}

export namespace Transaction {
    export function toDbTransaction
    (auth: giftbitRoutes.jwtauth.AuthorizationBadge, t: Transaction): DbTransaction {
        return {
            userId: auth.giftbitUserId,
            id: t.id,
            transactionType: t.transactionType,
            totals: JSON.stringify(t.totals),
            lineItems: JSON.stringify(t.lineItems),
            paymentSources: JSON.stringify(t.paymentSources),
            metadata: JSON.stringify(t.metadata),
            createdDate: t.createdDate
        };
    }
}

export namespace DbTransaction {
    export async function toTransactions(txns: DbTransaction[], userId: string): Promise<Transaction[]> {
        const knex = await getKnexRead();
        let txIds: string[] = txns.map(tx => tx.id);
        let lrDbSteps: any[] = await knex("LightrailTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds);
        const lrSteps: LightrailTransactionStep[] = lrDbSteps.map(step => DbTransactionStep.toLightrailTransactionStep(step));

        let stripeDbSteps = await knex("StripeTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds);
        const stripeSteps: StripeTransactionStep[] = stripeDbSteps.map(step => DbTransactionStep.toStripeTransactionStep(step));

        let internalDbSteps = await knex("InternalTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds);
        const internalSteps: InternalTransactionStep[] = internalDbSteps.map(step => DbTransactionStep.toInternalTransactionStep(step));

        const steps: TransactionStep[] = [...lrSteps, ...stripeSteps, ...internalSteps];

        let transactions: Transaction[] = txns.map(t => {
            return {
                id: t.id,
                transactionType: t.transactionType,
                totals: JSON.parse(t.totals),
                lineItems: JSON.parse(t.lineItems),
                paymentSources: JSON.parse(t.paymentSources),
                steps: [],
                metadata: JSON.parse(t.metadata),
                createdDate: t.createdDate
            };
        });

        for (let s of steps) {
            let transaction: Transaction = transactions.find(tx => tx.id === s.transactionId);
            transaction.steps = [...transaction.steps, s];
        }

        return transactions;
    }
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
    valueId: string;
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
    transactionId: string;
    valueId: string;
    // currency: string;
    contactId?: string;
    code?: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

export interface StripeTransactionStep {
    rail: "stripe";
    transactionId: string;
    amount: number;
    chargeId?: string;
    charge?: stripe.charges.ICharge;
}

export interface InternalTransactionStep {
    rail: "internal";
    transactionId: string;
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
    remainder?: number;
}

export interface DbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    currency: string;
    valueId?: string;
    contactId?: string;
    code?: string;
    balanceBefore?: number;
    balanceAfter?: number;
    balanceChange?: number;
    chargeId?: string;
    amount?: number;
    charge?: string;
    internalId?: string;
}

export namespace DbTransactionStep {
    export function toLightrailTransactionStep(step: DbTransactionStep): LightrailTransactionStep {
        return {
            rail: "lightrail",
            transactionId: step.transactionId,
            valueId: step.valueId,
            contactId: step.contactId || null,
            code: step.code || null,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }

    export function toStripeTransactionStep(step: DbTransactionStep): StripeTransactionStep {
        return {
            rail: "stripe",
            transactionId: step.transactionId,
            amount: step.amount,
            chargeId: step.chargeId || null,
            charge: JSON.parse(step.charge) || null
        };
    }

    export function toInternalTransactionStep(step: DbTransactionStep): InternalTransactionStep {
        return {
            rail: "internal",
            transactionId: step.transactionId,
            id: step.id,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }
}
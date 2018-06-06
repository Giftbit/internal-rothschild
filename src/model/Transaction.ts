import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../dbUtils/connection";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    cart?: CartTransaction;
    steps: TransactionStep[];
    remainder: number;
    simulated?: true;
    createdDate: Date;
    metadata?: object | null;
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
    metadata?: string | null;
}

export namespace DbTransaction {
    export async function toTransaction(t: DbTransaction): Promise<Transaction> {
        const knex = await getKnexRead();

        let dbSteps: any[] = await knex("LightrailTransactionSteps")
            .where("transactionId", t.id);
        dbSteps = dbSteps.concat(await knex("StripeTransactionSteps")
            .where("transactionId", t.id));
        dbSteps = dbSteps.concat(await knex("InternalTransactionSteps")
            .where("transactionId", t.id));

        return {
            id: t.id,
            transactionType: t.transactionType,
            cart: t.cart,
            steps: dbSteps,
            remainder: t.remainder,
            createdDate: t.createdDate,
            metadata: JSON.parse(t.metadata)
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

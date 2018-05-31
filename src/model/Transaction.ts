import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../dbUtils";

export interface Transaction {
    id: string;
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
            id: t.id,
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
    id: string;
    transactionType: TransactionType;
    cart: string | null;
    requestedPaymentSources: string | null;
    remainder: number;
    createdDate: Date;
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

        for (let step of dbSteps) {
            step.index = step.id.split("-").pop();
        }

        dbSteps.sort((step1, step2) => {
            return step1.index < step2.index ? -1 : step1.index > step2.index ? 1 : 0;
        });

        const steps: TransactionStep[] = dbSteps.map(step => {
            delete step.index;
            return step;
        });


        return {
            id: t.id,
            transactionType: t.transactionType,
            cart: t.cart,
            steps: steps,
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

import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../utils/dbUtils/connection";
import {LineItem} from "./LineItem";
import {TransactionParty} from "./TransactionRequest";
import {LightrailDbTransactionStep} from "./Transaction";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    currency: string;
    steps: TransactionStep[];
    totals: TransactionPlanTotals;
    lineItems: LineItem[] | null;
    paymentSources: TransactionParty[] | null;
    simulated?: true;
    createdDate: Date;
    metadata: object | null;
}

export interface DbTransaction {
    userId: string;
    id: string;
    transactionType: TransactionType;
    currency: string;
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
            currency: t.currency,
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
                currency: t.currency,
                totals: JSON.parse(t.totals),
                lineItems: JSON.parse(t.lineItems),
                paymentSources: JSON.parse(t.paymentSources),
                steps: dbSteps.filter(s => s.transactionId === t.id).map(DbTransactionStep.toTransactionStep),
                metadata: JSON.parse(t.metadata),
                createdDate: t.createdDate
            };
        });
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
    | "checkout"
    | "transfer"
    | "pending_create"
    | "pending_capture"
    | "pending_void";

export type TransactionStep = LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep;

export interface LightrailTransactionStep {
    rail: "lightrail";
    valueId: string;
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

export interface TransactionPlanTotals {
    subtotal?: number;
    tax?: number;
    discount?: number;
    payable?: number;
    remainder?: number;
    marketplace?: MarketplaceTransactionTotals;
}

export interface MarketplaceTransactionTotals {
    sellerGross: number;
    sellerDiscount: number;
    sellerNet: number;
}

export type DbTransactionStep = LightrailDbTransactionStep | StripeDbTransactionStep | InternalDbTransactionStep;

export interface LightrailDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    valueId: string;
    contactId?: string;
    code?: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

export interface StripeDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    currency: string;
    chargeId: string;
    amount: number;
    charge: string;
}

export interface InternalDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
    internalId: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

function isLightrailDbTransactionStep(step: DbTransactionStep): step is LightrailDbTransactionStep {
    return (<LightrailDbTransactionStep>step).valueId !== undefined;
}

function isStripeDbTransactionStep(step: DbTransactionStep): step is StripeDbTransactionStep {
    return (<StripeDbTransactionStep>step).chargeId !== undefined;
}

function isInternalDbTransactionStep(step: DbTransactionStep): step is InternalDbTransactionStep {
    return (<InternalDbTransactionStep>step).internalId !== undefined;
}

export namespace DbTransactionStep {
    export function toTransactionStep(step: DbTransactionStep): TransactionStep {
        if (isLightrailDbTransactionStep(step)) {
            return toLightrailTransactionStep(step);
        }
        if (isStripeDbTransactionStep(step)) {
            return toStripeTransactionStep(step);
        }
        if (isInternalDbTransactionStep(step)) {
            return toInternalTransactionStep(step);
        }
    }

    export function toLightrailTransactionStep(step: LightrailDbTransactionStep): LightrailTransactionStep {
        return {
            rail: "lightrail",
            valueId: step.valueId,
            contactId: step.contactId || null,
            code: step.code || null,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }

    export function toStripeTransactionStep(step: StripeDbTransactionStep): StripeTransactionStep {
        return {
            rail: "stripe",
            amount: step.amount,
            chargeId: step.chargeId || null,
            charge: JSON.parse(step.charge) || null
        };
    }

    export function toInternalTransactionStep(step: InternalDbTransactionStep): InternalTransactionStep {
        return {
            rail: "internal",
            id: step.id,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }
}

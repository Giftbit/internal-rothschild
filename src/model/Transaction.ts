import * as stripe from "stripe";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../utils/dbUtils/connection";
import {LineItem} from "./LineItem";
import {TransactionParty} from "./TransactionRequest";
import {LightrailDbTransactionStep, TransactionType} from "./Transaction";
import {TaxRequestProperties} from "./TaxProperties";

export interface Transaction {
    id: string;
    transactionType: TransactionType;
    currency: string;
    steps: TransactionStep[];
    totals: TransactionTotals;
    lineItems: LineItem[] | null;
    paymentSources: TransactionParty[] | null;
    simulated?: true;
    pending?: boolean;
    pendingVoidDate?: Date;
    createdDate: Date;
    createdBy: string;
    metadata: object | null;
    tax: TaxRequestProperties | null;
}

export interface DbTransaction {
    userId: string;
    id: string;
    transactionType: TransactionType;
    currency: string;
    totals_subtotal: number | null;
    totals_tax: number | null;
    totals_discountLightrail: number | null;
    totals_paidLightrail: number | null;
    totals_paidStripe: number | null;
    totals_paidInternal: number | null;
    totals_remainder: number | null;
    totals_forgiven: number | null;
    totals_unaccounted: number | null;
    totals_marketplace_sellerGross: number | null;
    totals_marketplace_sellerDiscount: number | null;
    totals_marketplace_sellerNet: number | null;
    lineItems: string | null;
    paymentSources: string | null;
    createdDate: Date;
    createdBy: string;
    metadata: string | null;
    rootTransactionId: string | null;
    nextTransactionId: string | null;
    tax: string | null;
    pendingVoidDate: Date | null;
}

export namespace Transaction {
    export function toDbTransaction
    (auth: giftbitRoutes.jwtauth.AuthorizationBadge, t: Transaction): DbTransaction {
        console.log("Transaction.toDbTransaction t.totals && t.totals.forgiven=", t.totals && t.totals.forgiven);
        return {
            userId: auth.userId,
            id: t.id,
            transactionType: t.transactionType,
            currency: t.currency,
            totals_subtotal: t.totals && t.totals.subtotal,
            totals_tax: t.totals && t.totals.tax,
            totals_discountLightrail: t.totals && t.totals.discountLightrail,
            totals_paidLightrail: t.totals && t.totals.paidLightrail,
            totals_paidStripe: t.totals && t.totals.paidStripe,
            totals_paidInternal: t.totals && t.totals.paidInternal,
            totals_remainder: t.totals && t.totals.remainder,
            totals_forgiven: t.totals && t.totals.forgiven,
            totals_unaccounted: t.totals && t.totals.unaccounted,
            totals_marketplace_sellerGross: t.totals && t.totals.marketplace && t.totals.marketplace.sellerGross,
            totals_marketplace_sellerDiscount: t.totals && t.totals.marketplace && t.totals.marketplace.sellerDiscount,
            totals_marketplace_sellerNet: t.totals && t.totals.marketplace && t.totals.marketplace.sellerNet,
            lineItems: t.lineItems != null ? JSON.stringify(t.lineItems) : null,
            paymentSources: t.paymentSources != null ? JSON.stringify(t.paymentSources) : null,
            metadata: t.metadata != null ? JSON.stringify(t.metadata) : null,
            rootTransactionId: null, // set during insert
            nextTransactionId: null,
            tax: t.tax != null ? JSON.stringify(t.tax) : null,
            pendingVoidDate: t.pendingVoidDate,
            createdDate: t.createdDate,
            createdBy: t.createdBy,
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

        return txns.map(dbT => {
            let t: Transaction = {
                id: dbT.id,
                transactionType: dbT.transactionType,
                currency: dbT.currency,
                totals: null,
                lineItems: JSON.parse(dbT.lineItems),
                paymentSources: JSON.parse(dbT.paymentSources),
                steps: dbSteps.filter(s => s.transactionId === dbT.id).map(DbTransactionStep.toTransactionStep),
                metadata: JSON.parse(dbT.metadata),
                tax: JSON.parse(dbT.tax),
                pending: !!dbT.pendingVoidDate,
                pendingVoidDate: dbT.pendingVoidDate || undefined,
                createdDate: dbT.createdDate,
                createdBy: dbT.createdBy
            };
            if (hasNonNullTotals(dbT)) {
                let payable: number;
                if (dbT.totals_subtotal !== null && dbT.totals_tax !== null && dbT.totals_discountLightrail !== null) {
                    payable = dbT.totals_subtotal + dbT.totals_tax - dbT.totals_discountLightrail;
                }
                t.totals = {
                    subtotal: dbT.totals_subtotal !== null ? dbT.totals_subtotal : undefined,
                    tax: dbT.totals_tax !== null ? dbT.totals_tax : undefined,
                    discount: dbT.totals_discountLightrail !== null ? dbT.totals_discountLightrail : undefined,
                    discountLightrail: dbT.totals_discountLightrail !== null ? dbT.totals_discountLightrail : undefined,
                    payable: payable !== null ? payable : undefined,
                    paidLightrail: dbT.totals_paidLightrail !== null ? dbT.totals_paidLightrail : undefined,
                    paidStripe: dbT.totals_paidStripe !== null ? dbT.totals_paidStripe : undefined,
                    paidInternal: dbT.totals_paidInternal !== null ? dbT.totals_paidInternal : undefined,
                    remainder: dbT.totals_remainder !== null ? dbT.totals_remainder : undefined,
                    forgiven: dbT.totals_forgiven !== null ? dbT.totals_forgiven : undefined,
                    unaccounted: dbT.totals_unaccounted !== null ? dbT.totals_unaccounted : undefined,
                    marketplace: undefined
                };

                if (dbT.totals_marketplace_sellerNet !== null) {
                    t.totals.marketplace = {
                        sellerGross: dbT.totals_marketplace_sellerGross,
                        sellerDiscount: dbT.totals_marketplace_sellerDiscount,
                        sellerNet: dbT.totals_marketplace_sellerNet,
                    };
                }
            }
            return t;
        });
    }
}

function hasNonNullTotals(dbT: DbTransaction): boolean {
    return dbT.totals_subtotal !== null ||
        dbT.totals_tax !== null ||
        dbT.totals_discountLightrail !== null ||
        dbT.totals_paidLightrail !== null ||
        dbT.totals_paidStripe !== null ||
        dbT.totals_paidInternal !== null ||
        dbT.totals_remainder !== null ||
        dbT.totals_forgiven !== null ||
        dbT.totals_unaccounted !== null ||
        dbT.totals_marketplace_sellerGross !== null ||
        dbT.totals_marketplace_sellerDiscount !== null ||
        dbT.totals_marketplace_sellerNet !== null;
}

export type TransactionType =
    "initialBalance"
    | "attach"
    | "credit"
    | "debit"
    | "checkout"
    | "transfer"
    | "reverse"
    | "capture"
    | "void";

export type TransactionStep = LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep;

export interface LightrailTransactionStep {
    rail: "lightrail";
    valueId: string;
    contactId?: string;
    code?: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
    usesRemainingBefore?: number;
    usesRemainingAfter?: number;
    usesRemainingChange?: number;
}

export interface StripeTransactionStep {
    rail: "stripe";
    amount: number;
    chargeId?: string;
    charge?: stripe.charges.ICharge | stripe.refunds.IRefund | StripeTransactionStepError;
}

export interface StripeTransactionStepError extends stripe.IStripeError {
    object: "error";
}

export interface InternalTransactionStep {
    rail: "internal";
    internalId: string;
    balanceBefore: number;
    balanceAfter: number;
    balanceChange: number;
}

export interface TransactionTotals {
    subtotal?: number;
    tax?: number;
    discountLightrail?: number;
    paidLightrail?: number;
    paidStripe?: number;
    paidInternal?: number;
    remainder?: number;
    forgiven?: number;
    unaccounted?: number;
    marketplace?: MarketplaceTransactionTotals;
    discount?: number; // deprecated
    payable?: number; // deprecated
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
    balanceBefore: number | null;
    balanceAfter: number | null;
    balanceChange: number | null;
    usesRemainingBefore: number | null;
    usesRemainingAfter: number | null;
    usesRemainingChange: number | null;
}

export interface StripeDbTransactionStep {
    userId: string;
    id: string;
    transactionId: string;
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

    export function isLightrailDbTransactionStep(step: DbTransactionStep): step is LightrailDbTransactionStep {
        return (<LightrailDbTransactionStep>step).valueId !== undefined;
    }

    export function isStripeDbTransactionStep(step: DbTransactionStep): step is StripeDbTransactionStep {
        return (<StripeDbTransactionStep>step).chargeId !== undefined;
    }

    export function isInternalDbTransactionStep(step: DbTransactionStep): step is InternalDbTransactionStep {
        return (<InternalDbTransactionStep>step).internalId !== undefined;
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
            usesRemainingBefore: step.usesRemainingBefore,
            usesRemainingAfter: step.usesRemainingAfter,
            usesRemainingChange: step.usesRemainingChange
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
            internalId: step.internalId,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }
}

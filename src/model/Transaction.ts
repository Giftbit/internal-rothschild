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
    totals: string;
    totals_subtotal: number | null;
    totals_tax: number | null;
    totals_discountLightrail: number | null;
    totals_paidLightrail: number | null;
    totals_paidStripe: number | null;
    totals_paidInternal: number | null;
    totals_remainder: number | null;
    totals_marketplace_sellerGross: number | null;
    totals_marketplace_sellerDiscount: number | null;
    totals_marketplace_sellerNet: number | null;
    lineItems: string | null;
    paymentSources: string | null;
    createdDate: Date;
    createdBy: string;
    metadata: string | null;
    tax: string | null;
}

export namespace Transaction {
    export function toDbTransaction
    (auth: giftbitRoutes.jwtauth.AuthorizationBadge, t: Transaction): DbTransaction {
        let dbT: DbTransaction = {
            userId: auth.userId,
            id: t.id,
            transactionType: t.transactionType,
            currency: t.currency,
            totals: JSON.stringify(t.totals),
            totals_subtotal: null,
            totals_tax: null,
            totals_discountLightrail: null,
            totals_paidLightrail: null,
            totals_paidStripe: null,
            totals_paidInternal: null,
            totals_remainder: null,
            totals_marketplace_sellerGross: null,
            totals_marketplace_sellerDiscount: null,
            totals_marketplace_sellerNet: null,
            lineItems: JSON.stringify(t.lineItems),
            paymentSources: JSON.stringify(t.paymentSources),
            metadata: JSON.stringify(t.metadata),
            tax: JSON.stringify(t.tax),
            createdDate: t.createdDate,
            createdBy: t.createdBy,
        };
        if (t.totals) {
            dbT.totals_subtotal = t.totals.subtotal;
            dbT.totals_tax = t.totals.tax;
            dbT.totals_discountLightrail = t.totals.discountLightrail;
            dbT.totals_paidLightrail = t.totals.paidLightrail;
            dbT.totals_paidStripe = t.totals.paidStripe;
            dbT.totals_paidInternal = t.totals.paidInternal;
            dbT.totals_remainder = t.totals.remainder;
            if (t.totals.marketplace) {
                dbT.totals_marketplace_sellerGross = t.totals.marketplace.sellerGross;
                dbT.totals_marketplace_sellerDiscount = t.totals.marketplace.sellerDiscount;
                dbT.totals_marketplace_sellerNet = t.totals.marketplace.sellerNet;
            }
        }
        return dbT;
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
                totals: {},
                lineItems: JSON.parse(dbT.lineItems),
                paymentSources: JSON.parse(dbT.paymentSources),
                steps: dbSteps.filter(s => s.transactionId === dbT.id).map(DbTransactionStep.toTransactionStep),
                metadata: JSON.parse(dbT.metadata),
                tax: JSON.parse(dbT.tax),
                createdDate: dbT.createdDate,
                createdBy: dbT.createdBy
            };
            if (dbT.transactionType === "checkout") {
                t.totals = {
                    subtotal: dbT.totals_subtotal,
                    tax: dbT.totals_tax,
                    discountLightrail: dbT.totals_discountLightrail,
                    paidLightrail: dbT.totals_paidLightrail,
                    paidStripe: dbT.totals_paidStripe,
                    paidInternal: dbT.totals_paidInternal,
                    remainder: dbT.totals_remainder,
                    discount: dbT.totals_discountLightrail, // deprecated
                    payable: dbT.totals_paidLightrail + dbT.totals_paidStripe + dbT.totals_paidInternal, // deprecated
                    marketplace: undefined
                };

                if (dbT.totals_marketplace_sellerNet !== null) {
                    t.totals.marketplace = {
                        sellerGross: dbT.totals_marketplace_sellerGross,
                        sellerDiscount: dbT.totals_marketplace_sellerDiscount,
                        sellerNet: dbT.totals_marketplace_sellerNet,
                    }
                }
            }
            return t;
        });
    }
}

export type TransactionType =
    "initialBalance"
    | "credit"
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
    marketplace?: MarketplaceTransactionTotals;
    discount?: number; // deprecated. todo - eventually remove from api once customers have been notified
    payable?: number; // deprecated. todo - eventually remove from api once customers have been notified
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
            internalId: step.internalId,
            balanceBefore: step.balanceBefore,
            balanceAfter: step.balanceAfter,
            balanceChange: step.balanceChange,
        };
    }
}

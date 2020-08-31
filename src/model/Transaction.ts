import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead} from "../utils/dbUtils/connection";
import {LineItem} from "./LineItem";
import {TransactionParty} from "./TransactionRequest";
import {TaxRequestProperties} from "./TaxProperties";
import {DbTransactionTag, Tag} from "./Tag";
import {DbTransactionStep, TransactionStep} from "./TransactionStep";

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
    tags: Tag[];
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
    marketplace?: MarketplaceTransactionTotals;
    discount?: number; // deprecated
    payable?: number; // deprecated
}

export interface MarketplaceTransactionTotals {
    sellerGross: number;
    sellerDiscount: number;
    sellerNet: number;
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
    export function toDbTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, t: Transaction, rootTransactionId: string): DbTransaction {
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
            totals_marketplace_sellerGross: t.totals && t.totals.marketplace && t.totals.marketplace.sellerGross,
            totals_marketplace_sellerDiscount: t.totals && t.totals.marketplace && t.totals.marketplace.sellerDiscount,
            totals_marketplace_sellerNet: t.totals && t.totals.marketplace && t.totals.marketplace.sellerNet,
            lineItems: t.lineItems != null ? JSON.stringify(t.lineItems) : null,
            paymentSources: t.paymentSources != null ? JSON.stringify(t.paymentSources) : null,
            metadata: t.metadata != null ? JSON.stringify(t.metadata) : null,
            rootTransactionId: rootTransactionId,
            nextTransactionId: null,
            tax: t.tax != null ? JSON.stringify(t.tax) : null,
            pendingVoidDate: t.pendingVoidDate,
            createdDate: t.createdDate,
            createdBy: t.createdBy
        };
    }
}

export namespace DbTransaction {
    export function toTransaction(dbTx: DbTransaction, dbSteps: DbTransactionStep[], dbTags: DbTransactionTag[]): Transaction {
        const t: Transaction = {
            id: dbTx.id,
            transactionType: dbTx.transactionType,
            currency: dbTx.currency,
            totals: null,
            lineItems: JSON.parse(dbTx.lineItems),
            paymentSources: JSON.parse(dbTx.paymentSources),
            steps: dbSteps.map(DbTransactionStep.toTransactionStep),
            metadata: JSON.parse(dbTx.metadata),
            tax: JSON.parse(dbTx.tax),
            pending: !!dbTx.pendingVoidDate,
            pendingVoidDate: dbTx.pendingVoidDate || undefined,
            createdDate: dbTx.createdDate,
            createdBy: dbTx.createdBy,
            tags: dbTags.length > 0 ? dbTags.map(dbTxTag => ({id: dbTxTag.tagId})) : []
        };
        if (hasNonNullTotals(dbTx)) {
            let payable: number;
            if (dbTx.totals_subtotal !== null && dbTx.totals_tax !== null && dbTx.totals_discountLightrail !== null) {
                payable = dbTx.totals_subtotal + dbTx.totals_tax - dbTx.totals_discountLightrail;
            }
            t.totals = {
                subtotal: dbTx.totals_subtotal !== null ? dbTx.totals_subtotal : undefined,
                tax: dbTx.totals_tax !== null ? dbTx.totals_tax : undefined,
                discount: dbTx.totals_discountLightrail !== null ? dbTx.totals_discountLightrail : undefined,
                discountLightrail: dbTx.totals_discountLightrail !== null ? dbTx.totals_discountLightrail : undefined,
                payable: payable !== null ? payable : undefined,
                paidLightrail: dbTx.totals_paidLightrail !== null ? dbTx.totals_paidLightrail : undefined,
                paidStripe: dbTx.totals_paidStripe !== null ? dbTx.totals_paidStripe : undefined,
                paidInternal: dbTx.totals_paidInternal !== null ? dbTx.totals_paidInternal : undefined,
                remainder: dbTx.totals_remainder !== null ? dbTx.totals_remainder : undefined,
                forgiven: dbTx.totals_forgiven !== null ? dbTx.totals_forgiven : undefined,
                marketplace: undefined
            };

            if (dbTx.totals_marketplace_sellerNet !== null) {
                t.totals.marketplace = {
                    sellerGross: dbTx.totals_marketplace_sellerGross,
                    sellerDiscount: dbTx.totals_marketplace_sellerDiscount,
                    sellerNet: dbTx.totals_marketplace_sellerNet
                };
            }
        }
        return t;
    }

    export async function toTransactionsUsingDb(txns: DbTransaction[], userId: string): Promise<Transaction[]> {
        const knex = await getKnexRead();
        const txIds: string[] = txns.map(tx => tx.id);
        let dbSteps: any[] = await knex("LightrailTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds);
        dbSteps = dbSteps.concat(await knex("StripeTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds));
        dbSteps = dbSteps.concat(await knex("InternalTransactionSteps")
            .where("userId", userId)
            .whereIn("transactionId", txIds));

        const dbTxTags: DbTransactionTag[] = await knex("TransactionsTags")
            .where("TransactionsTags.userId", userId)
            .whereIn("TransactionsTags.transactionId", txIds);

        return txns.map(dbTx => toTransaction(dbTx, dbSteps.filter(step => step.transactionId === dbTx.id), dbTxTags.filter(tag => tag.transactionId === dbTx.id)));
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

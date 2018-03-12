import * as dynameh from "dynameh";

export interface Transaction {
    id: string;
    date: string;
    status: "pending" | "final";
    parties: TransactionParty[];
    version?: number;
}

export interface TransactionParty {
    partyId: string;
}

export interface LightrailTransaction extends TransactionParty {
    partyId: "lightrail";
    bucketId: string;
    value: number;
    currency: string;
}

export interface StripeTransaction extends TransactionParty {
    partyId: "stripe";
    chargeId: string;
    amount: number;
    currency: string;
}

export interface MerchantTransaction extends TransactionParty {
    partyId: "merchant";
    reason: "fund" | "refund" | "cancel" | "sale";
    cart?: object;
}

export function getTransactionTableSchema(userId: string): dynameh.TableSchema {
    return {
        tableName: `transactions-${userId}`,
        primaryKeyField: "id",
        primaryKeyType: "string",
        versionKeyField: "version"
    };
}

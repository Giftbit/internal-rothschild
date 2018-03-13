import * as dynameh from "dynameh";

export interface MoneyBucket {
    id: string;
    contactId?: string;
    type: "accountCredit" | "giftcard" | "promotion";   // etc...
    value: number;
    currency: string;
    dateStart?: string;
    dateEnd?: string;
    status: {
        frozen?: boolean;
        inactive?: boolean;
        expired?: boolean;
    };
    redemptionRule?: Rule;
    valueRule?: Rule;
    pendingTransactions?: PendingTransaction[];
    version?: number;
}

export interface PendingTransaction {
    id: string;
}

export interface Rule {
    rule: string;
    explanation: string;
}

// We'll end up with a table per merchant.  Is that a bad idea?
export function getMoneyBucketTableSchema(userId: string): dynameh.TableSchema {
    return {
        tableName: `moneyBucket-${userId}`,
        primaryKeyField: "id",
        primaryKeyType: "string",
        versionKeyField: "version"
    };
}

export function getMoneyBucketByContactTableSchema(userId: string): dynameh.TableSchema {
    return {
        tableName: `moneybucket-${userId}`,
        primaryKeyField: "contactId",
        primaryKeyType: "string",
        sortKeyField: "type",
        sortKeyType: "string",
        indexName: `moneyBucketByContact-${userId}`,
        versionKeyField: "version"
    };
}

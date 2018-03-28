export interface ValueStore {
    userId: string;
    valueStoreId: string;
    valueStoreType: ValueStoreType;
    currency: string;
    createdDate: Date;
    updatedDate: Date;
    value: number | null;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    redemptionRule: Rule | null;
    valueRule: Rule | null;
    usesLeft: number | null;
    startDate: Date | null;
    endDate: Date | null;
}

export type ValueStoreType = "GIFTCARD" | "ACCOUNT_CREDIT" | "PROMOTION";

export interface Rule {
    rule: string;
    explanation: string;
}

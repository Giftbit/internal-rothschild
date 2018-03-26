export interface ValueStore {
    valueStoreId: string;
    userId: string;
    createdDate: Date;
    updatedDate: Date;

    currency: string;
    valueStoreType: ValueStoreType;
    value: number;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    redemptionRule: Rule;
    valueRule: Rule;
    usesLeft: number | null;
    startDate: Date;
    endDate: Date;
}

export interface Rule {
    rule: string;
    explanation: string;
}

export enum ValueStoreType {
    PREPAID,
    PERCENT_OFF,
    UNIT
}
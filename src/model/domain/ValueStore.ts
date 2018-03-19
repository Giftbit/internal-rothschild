export interface ValueStore {
    id: string; // todo - do we want to call these ids or valueStoreIds
    merchantId: string; // todo - is this column necessary? Would a merchant list their valueStores outside of the context of a ValueStoreAccess?
    valueStoreType: "PREPAID" | "PERCENT_OFF" | "UNIT";
    value: number;
    currency: string;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    redemptionRule: Rule;
    dateCreated: Date;
    lastUpdated: Date;
    startDate: Date;
    endDate: Date;
    usesLeft: number | null;

}

export interface Rule {
    rule: string;
    explanation: string;
}
export interface ValueStore {
    id: string; // todo - do we want to call these ids or valueStoreIds
    merchantId: string; // todo - is this column necessary? Would a merchant list their valueStores outside of the context of a ValueStoreAccess?
    valueStoreType: "PREPAID" | "PERCENT_OFF" | "UNIT"; // todo - PREPAID? What about FINANCIAL_UNIT?
    value: number; // in the case of percent_off this represents the max value that can be spent
    percentOff: number;
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
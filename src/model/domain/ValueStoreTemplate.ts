import {Rule} from "./ValueStore";

export interface ValueStoreTemplate {
    id: string;
    merchantId: string;
    valueStoreType: string;
    value?: number;
    discountRate?: number;
    minInitialValue?: number; // todo - do we care?
    maxInitialValue?: number;
    currency: string;
    startDate?: Date;
    endDate?: Date;
    validityDurationInDays?: number;
    valueStoreUses?: number;
    redemptionRule: Rule;
}
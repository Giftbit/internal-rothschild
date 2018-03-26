import {Rule, ValueStoreType} from "./ValueStore";

export interface ValueStoreTemplate {
    valueStoreTemplateId: string;
    userId: string;

    dateCreated?: Date;
    startDate?: Date;
    endDate?: Date;

    currency: string;
    initialValue?: number;
    minInitialValue?: number;
    maxInitialValue?: number;
    validityDurationInDays?: number;
    valueStoreType: ValueStoreType;
    valueStoreUses?: number;
    redemptionRule: Rule;
    valueRule: Rule;
}
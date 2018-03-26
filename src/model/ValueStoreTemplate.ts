import {Rule, ValueStoreType} from "./ValueStore";

export interface ValueStoreTemplate {
    valueStoreTemplateId: string;
    userId: string;
    createdDate: Date;
    updatedDate: Date;

    currency: string;
    initialValue?: number;
    minInitialValue?: number;
    maxInitialValue?: number;
    validityDurationInDays?: number;
    valueStoreType: ValueStoreType;
    valueStoreUses?: number;
    redemptionRule: Rule;
    valueRule: Rule;
    startDate?: Date;
    endDate?: Date;
}
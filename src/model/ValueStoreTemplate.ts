import {Rule, ValueStoreType} from "./ValueStore";

export interface ValueStoreTemplate {
    valueStoreTemplateId: string;
    userId: string;

    currency: string;
    initialValue?: number;
    minInitialValue?: number;
    maxInitialValue?: number;
    validityDurationInDays?: number;
    valueStoreType: ValueStoreType;
    valueStoreUses?: number;
    redemptionRule: Rule;
    valueRule: Rule;

    createdDate: Date;
    updatedDate: Date;
    startDate?: Date;
    endDate?: Date;
}
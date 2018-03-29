import {Rule, ValueStoreType} from "./ValueStore";

export interface ValueStoreTemplate {
    valueStoreTemplateId: string;
    userId?: string; // todo - these are controlled by db. Made optional, otherwise you're forced to set when instantiating.
    createdDate?: Date; // todo - same here
    updatedDate?: Date; // todo - same here.

    currency: string;
    initialValue?: number;
    minInitialValue?: number;
    maxInitialValue?: number;
    validityDurationDays?: number;
    uses?: number;
    valueStoreType: ValueStoreType;
    valueStoreUses?: number;
    redemptionRule?: Rule;
    valueRule?: Rule;
    startDate?: Date;
    endDate?: Date;
}
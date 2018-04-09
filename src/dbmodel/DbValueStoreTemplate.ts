import {ValueStoreTemplate} from "../model/ValueStoreTemplate";

export interface DbValueStoreTemplate {
    userId: string;
    valueStoreTemplateId: string;
    currency: string;
    initialValue: number | null;
    pretax: boolean;
    minInitialValue: number | null;
    maxInitialValue: number | null;
    validityDurationDays: number | null;
    uses: number | null;
    valueStoreType: string;
    redemptionRule: string;
    valueRule: string;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date | null;
    updatedDate: Date | null;
}

export namespace DbValueStoreTemplate {
    export function toValueStoreTemplate(v: DbValueStoreTemplate): ValueStoreTemplate {
        return {
            valueStoreTemplateId: v.valueStoreTemplateId,
            currency: v.currency,
            initialValue: v.initialValue,
            pretax: v.pretax,
            minInitialValue: v.minInitialValue,
            maxInitialValue: v.maxInitialValue,
            validityDurationDays: v.validityDurationDays,
            uses: v.uses,
            valueStoreType: v.valueStoreType,
            redemptionRule: JSON.parse(v.redemptionRule),
            valueRule: JSON.parse(v.valueRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.parse(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }
}

import {ValueStore, ValueStoreType} from "../model/ValueStore";

export interface DbValueStore {
    userId: string;
    valueStoreId: string;
    valueStoreType: ValueStoreType;
    currency: string;
    value: number | null;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    redemptionRule: string;
    valueRule: string;
    usesLeft: number | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date;
    updatedDate: Date;
}

export namespace DbValueStore {
    export function toValueStore(v: DbValueStore): ValueStore {
        return {
            valueStoreId: v.valueStoreId,
            valueStoreType: v.valueStoreType,
            currency: v.currency,
            value: v.value,
            active: v.active,
            expired: v.expired,
            frozen: v.frozen,
            redemptionRule: JSON.parse(v.redemptionRule),
            valueRule: JSON.parse(v.valueRule),
            usesLeft: v.usesLeft,
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.parse(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        }
    }
}

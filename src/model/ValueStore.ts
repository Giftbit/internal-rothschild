import * as giftbitRoutes from "giftbit-cassava-routes";

export interface ValueStore {
    valueStoreId: string;
    valueStoreType: ValueStoreType;
    currency: string;
    value: number | null;
    pretax: boolean;
    active: boolean;
    expired: boolean;   // TODO we don't need to expose this to the user because it's implied by endDate
    frozen: boolean;
    redemptionRule: Rule | null;
    valueRule: Rule | null;
    uses: number | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
}

export type ValueStoreType = "GIFTCARD" | "ACCOUNT_CREDIT" | "PROMOTION";

export interface Rule {
    rule: string;
    explanation: string;
}

export namespace ValueStore {
    export function toDbValueStore(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: ValueStore): DbValueStore {
        return {
            userId: auth.giftbitUserId,
            valueStoreId: v.valueStoreId,
            valueStoreType: v.valueStoreType,
            currency: v.currency,
            value: v.value,
            pretax: v.pretax,
            active: v.active,
            expired: v.expired,
            frozen: v.frozen,
            redemptionRule: JSON.stringify(v.redemptionRule),
            valueRule: JSON.stringify(v.valueRule),
            uses: v.uses,
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }
}

export interface DbValueStore {
    userId: string;
    valueStoreId: string;
    valueStoreType: ValueStoreType;
    currency: string;
    value: number | null;
    pretax: boolean;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    redemptionRule: string;
    valueRule: string;
    uses: number | null;
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
            pretax: v.pretax,
            active: v.active,
            expired: v.expired,
            frozen: v.frozen,
            redemptionRule: JSON.parse(v.redemptionRule),
            valueRule: JSON.parse(v.valueRule),
            uses: v.uses,
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.parse(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }
}

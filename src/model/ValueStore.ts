import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbValueStore} from "../dbmodel/DbValueStore";

export interface ValueStore {
    valueStoreId: string;
    valueStoreType: ValueStoreType;
    currency: string;
    value: number | null;
    pretax: boolean;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    redemptionRule: Rule | null;
    valueRule: Rule | null;
    usesLeft: number | null;
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
            active: v.active,
            expired: v.expired,
            frozen: v.frozen,
            redemptionRule: JSON.stringify(v.redemptionRule),
            valueRule: JSON.stringify(v.valueRule),
            usesLeft: v.usesLeft,
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }
}

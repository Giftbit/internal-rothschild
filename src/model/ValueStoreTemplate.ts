import * as giftbitRoutes from "giftbit-cassava-routes";
import {Rule} from "./ValueStore";
import {DbValueStoreTemplate} from "../dbmodel/DbValueStoreTemplate";

export interface ValueStoreTemplate {
    valueStoreTemplateId: string;
    currency: string;
    initialValue: number | null;
    pretax: boolean;
    minInitialValue: number | null;
    maxInitialValue: number | null;
    validityDurationDays: number | null;
    uses: number | null;
    valueStoreType: string;
    redemptionRule: Rule | null;
    valueRule: Rule | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
}

export namespace ValueStoreTemplate {
    export function toDbValueStoreTemplate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: ValueStoreTemplate): DbValueStoreTemplate {
        return {
            userId: auth.giftbitUserId,
            valueStoreTemplateId: v.valueStoreTemplateId,
            currency: v.currency,
            initialValue: v.initialValue,
            minInitialValue: v.minInitialValue,
            maxInitialValue: v.maxInitialValue,
            validityDurationDays: v.validityDurationDays,
            uses: v.uses,
            valueStoreType: v.valueStoreType,
            redemptionRule: JSON.stringify(v.redemptionRule),
            valueRule: JSON.stringify(v.valueRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }
}

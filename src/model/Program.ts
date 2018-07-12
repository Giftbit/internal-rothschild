import * as giftbitRoutes from "giftbit-cassava-routes";
import {Rule} from "./Value";
import {pickDefined} from "../utils/pick";

export interface Program {
    id: string;
    name: string;
    currency: string;
    discount: boolean;
    discountSellerLiability: number | null;
    pretax: boolean;
    active: boolean;
    redemptionRule: Rule | null;
    valueRule: Rule | null;
    minInitialBalance: number | null;
    maxInitialBalance: number | null;
    fixedInitialBalances: number[];
    fixedInitialUses: number[];
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date | null;
    updatedDate: Date | null;
}

export namespace Program {
    export function toDbProgram(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Program): DbProgram {
        return {
            userId: auth.giftbitUserId,
            id: v.id,
            name: v.name,
            currency: v.currency,
            discount: v.discount,
            discountSellerLiability: v.discountSellerLiability,
            pretax: v.pretax,
            active: v.active,
            minInitialBalance: v.minInitialBalance,
            maxInitialBalance: v.maxInitialBalance,
            fixedInitialBalances: JSON.stringify(v.fixedInitialBalances),
            fixedInitialUses: JSON.stringify(v.fixedInitialUses),
            redemptionRule: JSON.stringify(v.redemptionRule),
            valueRule: JSON.stringify(v.valueRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }

    export function toDbProgramUpdate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Partial<Program>): Partial<DbProgram> {
        return pickDefined({
            name: v.name,
            currency: v.currency,
            discount: v.discount,
            discountSellerLiability: v.discountSellerLiability,
            pretax: v.pretax,
            active: v.active,
            redemptionRule: JSON.stringify(v.redemptionRule),
            valueRule: JSON.stringify(v.valueRule),
            minInitialBalance: v.minInitialBalance,
            maxInitialBalance: v.maxInitialBalance,
            fixedInitialBalances: JSON.stringify(v.fixedInitialBalances),
            fixedInitialUses: JSON.stringify(v.fixedInitialUses),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            updatedDate: v.updatedDate
        });
    }
}

export interface DbProgram {
    userId: string;
    id: string;
    name: string;
    currency: string;
    discount: boolean;
    discountSellerLiability: number | null;
    pretax: boolean;
    active: boolean;
    redemptionRule: string;
    valueRule: string;
    minInitialBalance: number | null;
    maxInitialBalance: number | null;
    fixedInitialBalances: string;
    fixedInitialUses: string;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date | null;
    updatedDate: Date | null;
}

export namespace DbProgram {
    export function toProgram(v: DbProgram): Program {
        return {
            id: v.id,
            name: v.name,
            currency: v.currency,
            discount: v.discount,
            discountSellerLiability: v.discountSellerLiability,
            pretax: v.pretax,
            active: v.active,
            minInitialBalance: v.minInitialBalance,
            maxInitialBalance: v.maxInitialBalance,
            fixedInitialBalances: JSON.parse(v.fixedInitialBalances),
            fixedInitialUses: JSON.parse(v.fixedInitialUses),
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

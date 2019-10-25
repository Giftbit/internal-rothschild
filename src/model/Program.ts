import * as giftbitRoutes from "giftbit-cassava-routes";
import {formatDiscountSellerLiabilityAsRule, formatDiscountSellerLiabilityRuleAsNumber, Rule} from "./Value";
import {pickDefined} from "../utils/pick";

export interface Program {
    id: string;
    name: string;
    currency: string;
    discount: boolean;
    discountSellerLiability: number | null;
    discountSellerLiabilityRule: Rule | null;
    pretax: boolean;
    active: boolean;
    redemptionRule: Rule | null;
    balanceRule: Rule | null;
    minInitialBalance: number | null;
    maxInitialBalance: number | null;
    fixedInitialBalances: number[];
    fixedInitialUsesRemaining: number[];
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date | null;
    updatedDate: Date | null;
    createdBy: string;
}

export namespace Program {
    export function toDbProgram(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Program): DbProgram {
        return {
            userId: auth.userId,
            id: v.id,
            name: v.name,
            currency: v.currency,
            discount: v.discount,
            discountSellerLiabilityRule: JSON.stringify(formatDiscountSellerLiabilityAsRule(v)),
            pretax: v.pretax,
            active: v.active,
            minInitialBalance: v.minInitialBalance,
            maxInitialBalance: v.maxInitialBalance,
            fixedInitialBalances: JSON.stringify(v.fixedInitialBalances),
            fixedInitialUsesRemaining: JSON.stringify(v.fixedInitialUsesRemaining),
            redemptionRule: JSON.stringify(v.redemptionRule),
            balanceRule: JSON.stringify(v.balanceRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate,
            createdBy: v.createdBy,
        };
    }

    export function toDbProgramUpdate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Partial<Program>): Partial<DbProgram> {
        return pickDefined({
            name: v.name,
            currency: v.currency,
            discount: v.discount,
            discountSellerLiability: !!v.discountSellerLiability ? v.discountSellerLiability.toString() : undefined,
            // todo - do something here
            pretax: v.pretax,
            active: v.active,
            redemptionRule: JSON.stringify(v.redemptionRule),
            balanceRule: JSON.stringify(v.balanceRule),
            minInitialBalance: v.minInitialBalance,
            maxInitialBalance: v.maxInitialBalance,
            fixedInitialBalances: JSON.stringify(v.fixedInitialBalances),
            fixedInitialUsesRemaining: JSON.stringify(v.fixedInitialUsesRemaining),
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
    discountSellerLiabilityRule: string;
    pretax: boolean;
    active: boolean;
    redemptionRule: string;
    balanceRule: string;
    minInitialBalance: number | null;
    maxInitialBalance: number | null;
    fixedInitialBalances: string;
    fixedInitialUsesRemaining: string;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date | null;
    updatedDate: Date | null;
    createdBy: string;
}

export namespace DbProgram {
    export function toProgram(v: DbProgram): Program {
        return {
            id: v.id,
            name: v.name,
            currency: v.currency,
            discount: v.discount,
            discountSellerLiability: formatDiscountSellerLiabilityRuleAsNumber(JSON.parse(v.discountSellerLiabilityRule)),
            discountSellerLiabilityRule: JSON.parse(v.discountSellerLiabilityRule),
            pretax: v.pretax,
            active: v.active,
            minInitialBalance: v.minInitialBalance,
            maxInitialBalance: v.maxInitialBalance,
            fixedInitialBalances: JSON.parse(v.fixedInitialBalances),
            fixedInitialUsesRemaining: JSON.parse(v.fixedInitialUsesRemaining),
            redemptionRule: JSON.parse(v.redemptionRule),
            balanceRule: JSON.parse(v.balanceRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.parse(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate,
            createdBy: v.createdBy
        };
    }
}

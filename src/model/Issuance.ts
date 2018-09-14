import {Rule} from "./Value";
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface Issuance {
    id: string;
    name: string;
    programId: string;
    count: number;
    balance: number | null;
    redemptionRule: Rule | null;
    valueRule: Rule | null; // todo - drop
    balanceRule: Rule | null;
    uses: number | null; // todo - drop
    usesRemaining: number | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
}

export namespace Issuance {
    export function toDbIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Issuance): DbIssuance {
        return {
            userId: auth.userId,
            id: v.id,
            programId: v.programId,
            count: v.count,
            balance: v.balance,
            balanceRule: JSON.stringify(v.balanceRule),
            redemptionRule: JSON.stringify(v.redemptionRule),
            usesRemaining: v.usesRemaining,
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            name: v.name,
            createdDate: v.createdDate,
            updatedDate: v.updatedDate,
        };
    }
}

export interface DbIssuance {
    userId: string;
    id: string;
    name: string;
    programId: string;
    count: number;
    balance: number | null;
    balanceRule: string;
    redemptionRule: string;
    usesRemaining: number | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date | null;
    updatedDate: Date | null;
}

export namespace DbIssuance {
    export function toIssuance(v: DbIssuance): Issuance {
        return {
            id: v.id,
            name: v.name,
            programId: v.programId,
            count: v.count,
            balance: v.balance,
            redemptionRule: JSON.parse(v.redemptionRule),
            valueRule: JSON.parse(v.balanceRule),
            balanceRule: JSON.parse(v.balanceRule),
            uses: v.usesRemaining, // todo - drop
            usesRemaining: v.usesRemaining,
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.parse(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate
        };
    }
}
import * as giftbitRoutes from "giftbit-cassava-routes";

export interface Value {
    id: string;
    currency: string;
    balance: number | null;
    uses: number | null;
    programId: string | null;
    code: string | null;
    contactId: string | null;
    pretax: boolean;
    active: boolean;
    expired: boolean;   // TODO we don't need to expose this to the user because it's implied by endDate
    frozen: boolean;
    discount: boolean;
    redemptionRule: Rule | null;
    valueRule: Rule | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
}

export interface Rule {
    rule: string;
    explanation: string;
}

export namespace Value {
    /**
     * Create a Value object where the code is known and not secured.
     */
    export function toDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Value): DbValue {
        return {
            userId: auth.giftbitUserId,
            id: v.id,
            currency: v.currency,
            balance: v.balance,
            uses: v.uses,
            programId: v.programId,
            code: v.code,
            codeHashed: null,
            codeLastFour: null,
            contactId: v.contactId,
            pretax: v.pretax,
            active: v.active,
            expired: v.expired,
            frozen: v.frozen,
            discount: v.discount,
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

export interface DbValue {
    userId: string;
    id: string;
    currency: string;
    balance: number | null;
    uses: number | null;
    programId: string | null;
    code: string | null;
    codeHashed: string | null;
    codeLastFour: string | null;
    contactId: string | null;
    pretax: boolean;
    active: boolean;
    expired: boolean;
    frozen: boolean;
    discount: boolean;
    redemptionRule: string;
    valueRule: string;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date;
    updatedDate: Date;
}

export namespace DbValue {
    export function toValue(v: DbValue): Value {
        return {
            id: v.id,
            currency: v.currency,
            balance: v.balance,
            uses: v.uses,
            programId: v.programId,
            contactId: v.contactId,
            code: v.code || (v.codeLastFour && "…" + v.codeLastFour) || null,
            pretax: v.pretax,
            active: v.active,
            expired: v.expired,
            frozen: v.frozen,
            discount: v.discount,
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

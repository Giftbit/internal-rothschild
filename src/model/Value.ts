import * as giftbitRoutes from "giftbit-cassava-routes";
import {pickDefined} from "../pick";
import {computeLookupHash, decrypt, encrypt} from "../services/codeCryptoUtils";

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
    canceled: boolean;
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
    export function toDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Value, genericCode: boolean): DbValue {
        const dbValue: DbValue = {
            userId: auth.giftbitUserId,
            id: v.id,
            currency: v.currency,
            balance: v.balance,
            uses: v.uses,
            programId: v.programId,
            code: v.code ? codeLastFour(v.code) : null,
            genericCode: v.code ? genericCode : null,
            encryptedCode: v.code ? encrypt(v.code) : null,
            codeHashed: v.code ? computeLookupHash(v.code, auth) : null,
            contactId: v.contactId,
            pretax: v.pretax,
            active: v.active,
            canceled: v.canceled,
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
        return dbValue;
    }

    export function toDbValueUpdate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Partial<Value>): Partial<DbValue> {
        if (v.canceled != null && !v.canceled) {
            throw new giftbitRoutes.GiftbitRestError(422, "A Value cannot be uncanceled (cancel = false).", "CannotUncancelValue");
        }

        return pickDefined({
            contactId: v.contactId,
            active: v.active,
            canceled: v.canceled,
            frozen: v.frozen,
            pretax: v.pretax,
            redemptionRule: JSON.stringify(v.redemptionRule),
            valueRule: JSON.stringify(v.valueRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            updatedDate: v.updatedDate
        });
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
    genericCode: boolean | null;
    codeHashed: string | null;
    encryptedCode: string | null;
    contactId: string | null;
    pretax: boolean;
    active: boolean;
    canceled: boolean;
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
    export function toValue(v: DbValue, showCode: boolean): Value {
        return {
            id: v.id,
            currency: v.currency,
            balance: v.balance,
            uses: v.uses,
            programId: v.programId,
            contactId: v.contactId,
            code: v.code && (v.genericCode || showCode) ? decrypt(v.encryptedCode) : v.code,
            pretax: v.pretax,
            active: v.active,
            canceled: v.canceled,
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

export function codeLastFour(code: string) {
    return "...".concat(code.substring(code.length - 4))
}
import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbCode, getCodeLastFourNoPrefix} from "./DbCode";
import {pickDefined} from "../utils/pick";
import {decryptCode} from "../utils/codeCryptoUtils";

export interface Value {
    id: string;
    currency: string;
    balance: number | null;
    usesRemaining: number | null;
    programId: string | null;
    issuanceId: string | null;
    code: string | null;
    isGenericCode: boolean | null;
    genericCodeOptions?: GenericCodeOptions | undefined;
    attachedFromValueId: string | undefined; // todo - drop word generic
    contactId: string | null;
    pretax: boolean;
    active: boolean;
    canceled: boolean;
    frozen: boolean;
    discount: boolean;
    discountSellerLiability: number | null;
    redemptionRule: Rule | null;
    balanceRule: Rule | null;
    startDate: Date | null;
    endDate: Date | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
    updatedContactIdDate: Date | null;
    createdBy: string;
}

export interface GenericCodeOptions {
    perContact: {
        balance: number | null;
        usesRemaining: number | null;
    };
}

export interface Rule {
    rule: string;
    explanation: string;
}

export namespace Value {
    export async function toDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, v: Value): Promise<DbValue> {
        let dbCode: DbCode = null;
        if (v.code) {
            dbCode = await DbCode.getDbCode(v.code, auth);
        }
        return {
            userId: auth.userId,
            id: v.id,
            currency: v.currency,
            balance: v.balance,
            usesRemaining: v.usesRemaining,
            programId: v.programId,
            issuanceId: v.issuanceId,
            codeLastFour: dbCode ? dbCode.lastFour : null,
            isGenericCode: v.isGenericCode,
            codeEncrypted: dbCode ? dbCode.codeEncrypted : null,
            codeHashed: dbCode ? dbCode.codeHashed : null,
            contactId: v.contactId,
            pretax: v.pretax,
            active: v.active,
            canceled: v.canceled,
            frozen: v.frozen,
            discount: v.discount,
            discountSellerLiability: v.discountSellerLiability,
            redemptionRule: JSON.stringify(v.redemptionRule),
            balanceRule: JSON.stringify(v.balanceRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate,
            updatedContactIdDate: v.updatedContactIdDate,
            createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,

            // generic code properties
            genericCodeOptions_perContact_balance: v.genericCodeOptions ? v.genericCodeOptions.perContact.balance : null,
            genericCodeOptions_perContact_usesRemaining: v.genericCodeOptions ? v.genericCodeOptions.perContact.usesRemaining : null,
            attachedFromValueId: v.attachedFromValueId
        };
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
            discount: v.discount,
            discountSellerLiability: v.discountSellerLiability,
            redemptionRule: JSON.stringify(v.redemptionRule),
            balanceRule: JSON.stringify(v.balanceRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.stringify(v.metadata),
            updatedDate: v.updatedDate
        });
    }

    export function toStringSanitized(v: Value): string {
        return JSON.stringify({
            ...v,
            code: v.code && !v.isGenericCode ? formatCodeForLastFourDisplay(v.code) : v.code
        });
    }

    export function isGenericCodeWithPropertiesPerContact(v: Value): boolean {
        return v.isGenericCode != null && v.genericCodeOptions != null && v.genericCodeOptions.perContact != null;
    }
}

export interface DbValue {
    userId: string;
    id: string;
    currency: string;
    balance: number | null;
    usesRemaining: number | null;
    programId: string | null;
    issuanceId: string | null;
    codeLastFour: string | null;
    codeHashed: string | null;
    codeEncrypted: string | null;
    contactId: string | null;
    pretax: boolean;
    active: boolean;
    canceled: boolean;
    frozen: boolean;
    discount: boolean;
    discountSellerLiability: number | null;
    redemptionRule: string;
    balanceRule: string;
    startDate: Date | null;
    endDate: Date | null;
    metadata: string;
    createdDate: Date;
    updatedDate: Date;
    updatedContactIdDate: Date | null;
    createdBy: string;
    isGenericCode: boolean | null;
    genericCodeOptions_perContact_balance: number | null;
    genericCodeOptions_perContact_usesRemaining: number | null;
    attachedFromValueId: string | null;
}

export namespace DbValue {
    export async function toValue(v: DbValue, showCode: boolean = false): Promise<Value> {
        return {
            id: v.id,
            currency: v.currency,
            balance: v.balance,
            usesRemaining: v.usesRemaining,
            programId: v.programId,
            issuanceId: v.issuanceId,
            contactId: v.contactId,
            code: await dbValueCodeToValueCode(v, showCode),
            isGenericCode: v.isGenericCode,
            genericCodeOptions: v.genericCodeOptions_perContact_balance != null || v.genericCodeOptions_perContact_usesRemaining != null ? {
                perContact: {
                    balance: v.genericCodeOptions_perContact_balance,
                    usesRemaining: v.genericCodeOptions_perContact_usesRemaining
                }
            } : undefined,
            attachedFromValueId: v.attachedFromValueId != null ? v.attachedFromValueId : undefined,
            pretax: v.pretax,
            active: v.active,
            canceled: v.canceled,
            frozen: v.frozen,
            discount: v.discount,
            discountSellerLiability: v.discountSellerLiability,
            redemptionRule: JSON.parse(v.redemptionRule),
            balanceRule: JSON.parse(v.balanceRule),
            startDate: v.startDate,
            endDate: v.endDate,
            metadata: JSON.parse(v.metadata),
            createdDate: v.createdDate,
            updatedDate: v.updatedDate,
            updatedContactIdDate: v.updatedContactIdDate,
            createdBy: v.createdBy
        };
    }
}

async function dbValueCodeToValueCode(v: DbValue, showCode: boolean): Promise<string> {
    if (v.codeLastFour) {
        if (v.isGenericCode || showCode) {
            return decryptCode(v.codeEncrypted);
        } else {
            return formatCodeForLastFourDisplay(v.codeLastFour);
        }
    } else {
        return null;
    }
}

export function formatCodeForLastFourDisplay(code: string): string {
    return "…" + getCodeLastFourNoPrefix(code);
}

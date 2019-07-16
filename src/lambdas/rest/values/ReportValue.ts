import {Rule} from "../../../model/Value";

export interface ReportValue {
    id: string;
    currency: string;
    balance: number | null;
    usesRemaining: number | null;
    programId: string | null;
    issuanceId: string | null;
    code: string | null;
    isGenericCode: boolean;
    "genericCodeOptions_perContact_balance": number;
    "genericCodeOptions_perContact_usesRemaining": number;
    attachedFromValueId?: string | undefined;
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
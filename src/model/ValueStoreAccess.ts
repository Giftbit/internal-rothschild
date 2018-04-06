export interface ValueStoreAccess {
    valueStoreAccessId: string;
    userId: string;
    createdDate: Date;
    updatedDate: Date;
    code: string | null;
    codeLastFour: string | null;
    customerId: string | null;
    type: "ACCOUNT" | "GIFT_CARD" | "UNIQUE_PROMOTION_CODE" | "GENERIC_PROMOTION_CODE" | "CUSTOMER_PROMOTION";
}

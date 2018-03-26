export interface ValueStoreAccess {
    id: string;
    merchantId: string;
    type: "ACCOUNT" | "GIFT_CARD" | "UNIQUE_PROMOTION_CODE" | "GENERIC_PROMOTION_CODE" | "CUSTOMER_PROMOTION"; // todo - Expanded PROMOTION types to encompass how the promotion is accessed.
    valueStoreId: string;
    contactId: string;
}
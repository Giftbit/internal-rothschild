export interface ValueStoreAccess {
    valueStoreId: string;
    userId: string;

    code: string;
    customerId: string;
    type: "ACCOUNT" | "GIFT_CARD" | "UNIQUE_PROMOTION_CODE" | "GENERIC_PROMOTION_CODE" | "CUSTOMER_PROMOTION";

    createdDate: Date;
    updatedDate: Date;
}
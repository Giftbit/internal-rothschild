export interface ValueStoreAccess {
    valueStoreId: string;
    userId: string;
    createdDate: Date;
    updatedDate: Date;

    code: string;
    customerId: string;
    type: "ACCOUNT" | "GIFT_CARD" | "UNIQUE_PROMOTION_CODE" | "GENERIC_PROMOTION_CODE" | "CUSTOMER_PROMOTION";
}
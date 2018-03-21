export interface ValueStoreAccess {
    id: string;
    merchantId: string;
    type: "ACCOUNT" | "GIFT_CARD" | "PROMOTION";
    valueStoreId: string;
    contactId: string;
}
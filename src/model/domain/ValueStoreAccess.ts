export interface ValueStoreAccess {
    id: string;
    merchantId: string;
    type: "ACCOUNT" | "FULLCODE" | "GENERIC_CODE";
    valueStoreId: string;
    customerId: string;
}
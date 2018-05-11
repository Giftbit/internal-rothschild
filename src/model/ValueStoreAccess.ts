export interface ValueStoreAccessDb {
    userId: string;
    valueStoreAccessId: string;
    valueStoreId: string;
    code: string | null;
    codeHashed: string | null;
    codeLastFour: string | null;
    customerId: string | null;
    automatic: boolean;
    automaticStartDate: Date | null;
    automaticEndDate: Date | null;
    createdDate: Date;
    updatedDate: Date;
}

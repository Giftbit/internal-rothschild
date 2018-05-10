export interface ValueStoreAccessDb {
    userId: string;
    valueStoreAccessId: string;
    code: string | null;
    codeHashed: string | null;
    codeLastFour: string | null;
    customerId: string | null;
    createdDate: Date;
    updatedDate: Date;
}

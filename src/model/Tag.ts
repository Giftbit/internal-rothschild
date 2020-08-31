export interface DbTag {
    userId: string;
    id: string;
    name: string | null;
    createdDate: Date;
    updatedDate: Date;
    createdBy: string;
}

export interface DbTransactionTag {
    userId: string;
    tagId: string;
    transactionId: string;
}

export interface Tag {
    id: string;
    name?: string;
}

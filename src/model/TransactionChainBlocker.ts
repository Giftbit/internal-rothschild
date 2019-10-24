export interface TransactionChainBlocker {
    userId: string;
    transactionId: string;
    type: string;
    metadata: object;
    createdDate: Date;
    updatedDate: Date;
}

export namespace TransactionChainBlocker {
    export function toDbTransactionChainBlocker(blocker: TransactionChainBlocker): DbTransactionChainBlocker {
        return {
            userId: blocker.userId,
            transactionId: blocker.transactionId,
            type: blocker.type,
            metadata: JSON.stringify(blocker.metadata),
            createdDate: blocker.createdDate,
            updatedDate: blocker.updatedDate
        };
    }
}

export interface DbTransactionChainBlocker {
    userId: string;
    transactionId: string;
    type: string;
    metadata: string;
    createdDate: Date;
    updatedDate: Date;
}

export namespace DbTransactionChainBlocker {
    export function toTransactionChainBlocker(blocker: DbTransactionChainBlocker): TransactionChainBlocker {
        return {
            userId: blocker.userId,
            transactionId: blocker.transactionId,
            type: blocker.type,
            metadata: JSON.parse(blocker.metadata),
            createdDate: blocker.createdDate,
            updatedDate: blocker.updatedDate
        };
    }
}

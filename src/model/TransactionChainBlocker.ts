/**
 * Represents a state that is blocking the Transaction chain from progressing.
 * So far this only means automatic void is blocked but it could mean more in the future.
 */
export interface TransactionChainBlocker {
    userId: string;

    /**
     * The transactionId for the end of the chain that is blocked.
     */
    transactionId: string;

    /**
     * The type of the block.  If blocked by an error the messageCode
     * is a good choice for this type.
     */
    type: string;

    /**
     * Information about the block stored in JSON.  The expected fields depend upon the `type`.
     */
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

export interface ProgramStats {
    /**
     * Count and sum(balance) of Values that are neither canceled
     * nor expired.
     */
    outstanding: {
        balance: number;
        count: number;
    };

    /**
     * Count and sum(balance) of Values that are canceled.
     */
    canceled: {
        balance: number;
        count: number;
    };

    /**
     * Count and sum(balance) of Values that are expired.
     */
    expired: {
        balance: number;
        count: number;
    };

    /**
     * Stats for debit and checkout Transactions involving a Value in this Program.
     */
    redeemed: {
        /**
         * Sum of LightrailTransactionSteps for Values in the Program.
         * Reverses and voids subtract from this number.
         */
        balance: number;

        /**
         * Number of unique Values with a debit or checkout.
         */
        count: number;

        /**
         * Number of debit or checkout Transactions.
         */
        transactionCount: number;
    };

    /**
     * Stats for checkout Transactions involving a Value in this Program.
     */
    checkout: {
        /**
         * The sum of LightrailTransactionSteps.balanceChange.
         * Reverses and voids subtract from this number.
         */
        lightrailSpend: number;

        /**
         * The sum of other steps and remainder.
         * Reverses and voids subtract from this number.
         */
        overspend: number;

        /**
         * The number of checkout Transactions.
         */
        transactionCount: number;
    };
}

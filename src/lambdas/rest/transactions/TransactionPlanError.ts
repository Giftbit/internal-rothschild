export class TransactionPlanError extends Error {

    readonly isTransactionPlanError = true;

    constructor(msg?: string) {
        super(msg);
    }
}

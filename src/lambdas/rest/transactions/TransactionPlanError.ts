export class TransactionPlanError extends Error {

    readonly isTransactionPlanError = true;

    constructor(public isReplanable: boolean, msg?: string) {
        super(msg);
    }
}

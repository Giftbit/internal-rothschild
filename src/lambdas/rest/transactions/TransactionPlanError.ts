export class TransactionPlanError extends Error {

    readonly isTransactionPlanError = true;
    readonly isReplanable: boolean;

    constructor(msg?: string, options: {isReplanable?: boolean} = {}) {
        super(msg);
        this.isReplanable = !!options.isReplanable;
    }
}

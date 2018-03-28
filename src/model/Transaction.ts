export interface Transaction {
    transactionId: string;
    userId: string;
    createdDate: Date;

    valueStoreId: string;
    orderId: string;
    value: number;
    type: "FUND" | "DRAWDOWN" | "DISCOUNT";
    ruleJustification: RuleJustification; // todo - this needs more though to indicate why a transaction was created given a cart and ValueStore
}

export interface RuleJustification {
    appliedTo: "ORDER" | "ITEM";
    productsAppliedTo: string[]
}
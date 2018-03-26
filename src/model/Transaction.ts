export interface Transaction {
    id: string;
    valueStoreId: string;
    orderId: string;
    value: number;
    dateCreated: Date;
    type: "FUND" | "DRAWDOWN" | "DISCOUNT";
    ruleJustification: RuleJustification; // todo - this needs more though to indicate why a transaction was created given a cart and ValueStore
}

export interface RuleJustification {
    appliedTo: "ORDER" | "ITEM";
    productsAppliedTo: string[]
}
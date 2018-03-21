export interface Transaction {
    id: string;
    valueStoreId: string;
    orderId: string;
    value: number;
    dateCreated: Date;
    type: "FUND" | "DRAWDOWN" | "DISCOUNT"; // todo - discount? feels a little weird
    // todo - how to store / tell whether a redemptionRule was applicable to a cart/item? Do we attempt to justify why it applied and what item it applied to?
    ruleJustification: RuleJustification;
}

export interface RuleJustification {
    appliedTo: "ORDER" | "ITEM";
    productsAppliedTo: string[]
}
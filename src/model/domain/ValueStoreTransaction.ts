export interface ValueStoreTransaction {
    id: string;
    valueStoreId: string;
    orderId: string;
    value: number;
    dateCreated: Date;
    type: "FUND" | "DRAWDOWN" | "DISCOUNT"; // todo - discount? feels a little weird
}
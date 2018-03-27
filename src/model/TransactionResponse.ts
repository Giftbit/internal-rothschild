export interface TransactionResponse {
    transactionType: "fund" | "charge" | "transfer";
    cart?: any; // includes item-level and cart-level explanation of how value was applied
    sources?: TransactionSource[];
    destinations?: TransactionDestination[];
}

export type TransactionSource = LightrailTransactionSource | StripeTransactionSource | InternalTransactionSource;

export interface LightrailTransactionSource {
    rail: "lightrail";
    valueStoreId: string;
    contactId?: string;
    codeLastFour?: string;
    valueBefore: number;
    valueAfter: number;
    valueUsed: number;
}

export interface StripeTransactionSource {
    rail: "stripe";
    chargeId: string;
    amount: number;
    // maybe the whole JSON from https://stripe.com/docs/api#charge_object
}

export interface InternalTransactionSource {
    rail: "internal";
    id: string;
    valueBefore: number;
    valueAfter: number;
    valueUsed: number;
}

export type TransactionDestination = LightrailTransactionDestination;

export interface LightrailTransactionDestination {
    rail: "lightrail";
    currency: string;
    customerId?: string;
    code?: string;
    valueStoreId?: string;
}

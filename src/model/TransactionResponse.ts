export interface TransactionResponse {
    transactionId: string;
    transactionType: "credit" | "debit" | "order" | "transfer" | "pending_create" | "pending_capture" | "pending_void";
    cart?: any; // includes item-level and cart-level explanation of how value was applied
    currency: string;
    steps: TransactionStep[];
}

export type TransactionStep = LightrailTransactionStep | StripeTransactionStep | InternalTransactionStep;

export interface LightrailTransactionStep {
    rail: "lightrail";
    valueStoreId: string;
    valueStoreType: string;
    customerId?: string;
    codeLastFour?: string;
    valueBefore: number;
    valueAfter: number;
    valueChange: number;
}

export interface StripeTransactionStep {
    rail: "stripe";
    chargeId: string;
    amount: number;
    // maybe the whole JSON from https://stripe.com/docs/api#charge_object
}

export interface InternalTransactionStep {
    rail: "internal";
    id: string;
    valueBefore: number;
    valueAfter: number;
    valueChange: number;
}

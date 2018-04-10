export interface OrderRequest {
    transactionId: string;
    cart: Cart;
    currency: string;
    sources: TransactionParty[];
    simulate?: boolean;
    allowRemainder?: boolean;
}

export interface CreditRequest {
    transactionId: string;
    destination: TransactionParty;
    value: number;
    currency: string;
    simulate?: boolean;
}

export interface DebitRequest {
    transactionId: string;
    source: TransactionParty;
    value: number;
    currency: string;
    simulate?: boolean;
    allowRemainder?: boolean;
}

export type Cart = any;

export type TransferRequest = CreditRequest & DebitRequest;

export type TransactionParty = LightrailTransactionParty | StripeTransactionParty | InternalTransactionParty;

export interface LightrailTransactionParty {
    rail: "lightrail";
    customerId?: string;
    code?: string;
    valueStoreId?: string;
}

export interface StripeTransactionParty {
    rail: "stripe";
    token: string;
    maxAmount?: number;
    priority?: number;
}

export interface InternalTransactionParty {
    rail: "internal";
    id: string;
    value: number;
    pretax?: boolean;
    appliedFirst?: boolean;
}

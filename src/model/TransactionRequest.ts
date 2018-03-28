export interface OrderRequest {
    transactionId: string;
    cart: any;
    currency: string;
    sources: TransactionParty[];
}

export interface CreditRequest {
    transactionId: string;
    destination: TransactionParty;
    value: number;
    currency: string;
}

export interface DebitRequest {
    transactionId: string;
    source: TransactionParty;
    value: number;
    currency: string;
}

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
}

export interface InternalTransactionParty {
    rail: "internal";
    id: string;
    value: number;
    appliedFirst?: boolean;
}

export interface OrderRequest {
    cart: any;
    sources: TransactionParty[];
}

export interface FundRequest {
    destination: TransactionParty;
    value: number;
    currency: string;
}

export interface ChargeRequest {
    source: TransactionParty;
    value: number;
    currency: string;
}

export type TransferRequest = FundRequest & ChargeRequest;

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

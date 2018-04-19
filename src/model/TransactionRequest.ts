import {LineItemRequest} from "./LineItem";

export interface OrderRequest {
    transactionId: string;
    lineItems: LineItemRequest[];
    currency: string;
    sources: TransactionParty[];
    simulate?: boolean;
    allowRemainder?: boolean;
    // metadata: object | null; // TODO
}

export interface CreditRequest {
    transactionId: string;
    destination: TransactionParty;
    amount: number;
    currency: string;
    simulate?: boolean;
    // metadata: object | null; // TODO
}

export interface DebitRequest {
    transactionId: string;
    source: TransactionParty;
    amount: number;
    currency: string;
    simulate?: boolean;
    allowRemainder?: boolean;
    // metadata: object | null; // TODO
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

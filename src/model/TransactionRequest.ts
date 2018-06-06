import {LineItemRequest} from "./LineItem";

export interface OrderRequest {
    id: string;
    lineItems: LineItemRequest[];
    currency: string;
    sources: TransactionParty[];
    simulate?: boolean;
    allowRemainder?: boolean;
    // metadata: object | null; // TODO
}

export interface CreditRequest {
    id: string;
    destination: TransactionParty;
    amount: number;
    currency: string;
    simulate?: boolean;
    // metadata: object | null; // TODO
}

export interface DebitRequest {
    id: string;
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
    contactId?: string;
    code?: string;
    valueId?: string;
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
    balance: number;
    pretax?: boolean;
    beforeLightrail?: boolean;
}

import {LineItemRequest} from "./LineItem";
import {TaxRequestProperties} from "./TaxProperties";

export interface CheckoutRequest {
    id: string;
    lineItems: LineItemRequest[];
    currency: string;
    sources: TransactionParty[];
    simulate?: boolean;
    allowRemainder?: boolean;
    tax?: TaxRequestProperties;
    metadata?: object;
}

export interface CreditRequest {
    id: string;
    destination: TransactionParty;
    amount?: number;
    uses?: number;
    currency: string;
    simulate?: boolean;
    metadata?: object;
}

export interface DebitRequest {
    id: string;
    source: TransactionParty;
    amount?: number;
    uses?: number;
    currency: string;
    simulate?: boolean;
    allowRemainder?: boolean;
    pending?: boolean | string;
    metadata?: object;
}

export interface ReverseRequest {
    id: string;
    simulate?: boolean;
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
    source?: string;
    customer?: string;
    maxAmount?: number;
    priority?: number;
    additionalStripeParams?: AdditionalStripeChargeParams;
}

export interface AdditionalStripeChargeParams {
    description?: string;
    on_behalf_of?: string;
    receipt_email?: string;
    statement_descriptor?: string;
    transfer_group?: string;
}

export interface InternalTransactionParty {
    rail: "internal";
    internalId: string;
    balance: number;
    pretax?: boolean;
    beforeLightrail?: boolean;
}

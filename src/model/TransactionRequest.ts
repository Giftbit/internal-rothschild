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
    pending?: boolean | string;
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
    metadata?: object;
}

export interface CaptureRequest {
    id: string;
    simulate?: boolean;
    metadata?: object;
}

export interface VoidRequest {
    id: string;
    simulate?: boolean;
    metadata?: object;
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
    application_fee?: string;
    application_fee_amount?: number;
    description?: string;
    on_behalf_of?: string;
    receipt_email?: string;
    shipping?: {
        address?: {
            city?: string;
            country?: string;
            line1?: string;
            line2?: string;
            postal_code?: string;
            state?: string;
        }
        carrier?: string;
        name?: string;
        phone?: string;
        tracking_number?: string;
    };
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

export interface OrderRequest {
    cart: any;
    sources: PaymentSource[];
}

export interface FundRequest {
    destination: PaymentDestination;
    value: number;
}

export interface ChargeRequest {
    source: PaymentSource;
    value: number;
}

export type TransferRequest = FundRequest & ChargeRequest;

export type PaymentSource = LightrailPaymentSource | StripePaymentSource | InternalPaymentSource;

export interface LightrailPaymentSource {
    rail: "lightrail";
    currency: string;
    customerId?: string;
    code?: string;
    valueStoreId?: string;
}

export interface StripePaymentSource {
    rail: "stripe";
    token: string;
}

export interface InternalPaymentSource {
    rail: "internal";
    id: string;
    value: number;
    appliedFirst?: boolean;
}

export type PaymentDestination = LightrailPaymentDestination;

export interface LightrailPaymentDestination {
    rail: "lightrail";
    currency: string;
    customerId?: string;
    code?: string;
    valueStoreId?: string;
}

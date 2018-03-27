export interface OrderRequest {
    cart: any;
    sources: Partner[];
}

export interface FundRequest {
    destination: Partner;
    value: number;
    currency: string;
}

export interface ChargeRequest {
    source: Partner;
    value: number;
    currency: string;
}

export type TransferRequest = FundRequest & ChargeRequest;

export type Partner = LightrailPartner | StripePartner | InternalPartner;

export interface LightrailPartner {
    rail: "lightrail";
    customerId?: string;
    code?: string;
    valueStoreId?: string;
}

export interface StripePartner {
    rail: "stripe";
    token: string;
}

export interface InternalPartner {
    rail: "internal";
    id: string;
    value: number;
    appliedFirst?: boolean;
}

export type PaymentSourceForStripeMetadata = LightrailSourceForStripeMetadata | InternalSourceForStripeMetadata | StripeSourceForStripeMetadata;

export interface LightrailSourceForStripeMetadata {
    rail: "lightrail";
    valueId: string;
}

export interface InternalSourceForStripeMetadata {
    rail: "internal";
    internalId: string;
}

export interface StripeSourceForStripeMetadata {
    rail: "stripe";
    source?: string;
    customer?: string;
}
export interface StripeCreateChargeParams {
    amount: number;
    currency: string;
    source?: string;
    customer?: string;
    description?: string;
    metadata?: any;
}
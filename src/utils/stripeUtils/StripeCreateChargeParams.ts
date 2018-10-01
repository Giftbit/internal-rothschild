export interface StripeCreateChargeParams {
    amount: number;
    currency: string;
    source?: string;
    customer?: string;
    description?: string;
    metadata?: any;
    on_behalf_of?: string;
    receipt_email?: string;
    statement_descriptor?: string;
    transfer_group?: string;
}

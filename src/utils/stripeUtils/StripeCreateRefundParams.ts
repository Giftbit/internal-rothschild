export interface StripeCreateRefundParams {
    amount: number;
    chargeId: string;
    reason?: string;
}
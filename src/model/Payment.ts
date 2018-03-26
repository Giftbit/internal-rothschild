/**
 * Not yet used. Will be used later.
 */
export interface Payment {
    paymentId: string;
    userId: string;
    createdDate: Date;

    currency: string;
    ccLastFour: string;
    ccFingerprint: string;
    orderId: string;
}
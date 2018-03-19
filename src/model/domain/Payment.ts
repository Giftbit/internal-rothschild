export interface Payment {
    id: string;
    merchantId: string;
    orderId: string;
    currency: string;
    ccLastFour: string;
    ccFingerprint: string;
}
export interface Order {
    id: string;
    merchantId: string;
    total: number;
    prepraid: number;
    promotion: number;
    externalPayment: number;
    tax: number;
    customerId: string;
}
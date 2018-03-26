/**
 * Not yet used. Will be used later.
 */
export interface Order {
    orderId: string;
    userId: string;

    cart: string;
    contactId: string;
    requestedPaymentSources: RequestedPaymentSource[];
    requestedValueStores: RequestedValueStore[];

    createdDate: Date;
}

interface RequestedValueStore {
    id?: string;
    code?: string;
    customerId?: string;
}

interface RequestedPaymentSource {
    stripeCardToken?: string;
    stripeCustomerId?: string;
}
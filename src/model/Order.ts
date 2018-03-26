/**
 * Not yet used. Will be used later.
 */
export interface Order {
    orderId: string;
    userId: string;
    createdDate: Date;

    cart: string;
    contactId: string;
    requestedPaymentSources: RequestedPaymentSource[];
    requestedValueStores: RequestedValueStore[];
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
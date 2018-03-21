export interface Order {
    id: string;
    merchantId: string;
    contactId: string;
    cart: string;
    requestedValueStores: RequestedValueStore[];
    requestedPaymentSources: RequestedPaymentSource[];
}

interface RequestedValueStore {
    id?: string;
    lookupCode?: string;
    customerId?: string;
}

interface RequestedPaymentSource {
    stripeCardToken?: string;
    stripeCustomerId?: string;
}
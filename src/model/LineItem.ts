export interface LineItemRequest {
    type: "product" | "shipping" | "fee";
    productId?: string;
    shippingId?: string;
    feeId?: string;
    variantId?: string;
    unitPrice: number;
    quantity?: number;
    tags?: string[];
    taxRate?: number;
    metadata?: any;
}

export interface LineItemResponse extends LineItemRequest {
    lineTotal: {
        subtotal: number;
        pretaxDiscount: number;
        tax: number;
        postTaxDiscount: number;
        payable: number;
    }
}
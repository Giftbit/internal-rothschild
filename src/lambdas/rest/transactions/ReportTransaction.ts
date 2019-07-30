export interface ReportTransaction {
    id: string;
    createdDate: Date;
    transactionType: string;
    currency: string;
    transactionAmount: number | string;
    checkout_subtotal: number | string;
    checkout_tax: number | string;
    checkout_discountLightrail: number | string;
    checkout_paidLightrail: number | string;
    checkout_paidStripe: number | string;
    checkout_paidInternal: number | string;
    checkout_remainder: number | string;
    checkout_forgiven: number | string;
    marketplace_sellerNet: number | string | null;
    marketplace_sellerGross: number | string | null;
    marketplace_sellerDiscount: number | string | null;
    stepsCount: number;
    metadata: string | null;
}

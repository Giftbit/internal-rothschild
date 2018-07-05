import {LightrailTransactionPlanStep, TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import {CheckoutRequest, TransactionParty} from "../../../../model/TransactionRequest";
import {LineItemResponse} from "../../../../model/LineItem";
import {TransactionPlanTotals, TransactionType} from "../../../../model/Transaction";
import {bankersRounding} from "../../../../utils/moneyUtils";
import {nowInDbPrecision} from "../../../../utils/dbUtils";

export class CheckoutTransactionPlan implements TransactionPlan {
    id: string;
    transactionType: TransactionType;
    currency: string;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[] | null;
    paymentSources: TransactionParty[] | null;
    steps: TransactionPlanStep[];
    createdDate: Date;
    metadata: object | null;

    constructor(checkout: CheckoutRequest, steps: TransactionPlanStep[]) {
        let lineItemResponses: LineItemResponse[] = [];
        for (let lineItem of checkout.lineItems) {
            lineItem.quantity = lineItem.quantity ? lineItem.quantity : 1;
            const subtotal = lineItem.unitPrice * lineItem.quantity;
            let lineItemResponse: LineItemResponse = {
                ...lineItem,
                lineTotal: {
                    subtotal: subtotal,
                    taxable: subtotal,
                    tax: 0,
                    discount: 0,
                    remainder: subtotal,
                    payable: 0
                }
            };
            lineItemResponses.push(lineItemResponse);
        }
        this.id = checkout.id;
        this.transactionType = "checkout";
        this.currency = checkout.currency;
        this.lineItems = lineItemResponses.sort((a, b) => b.lineTotal.subtotal - a.lineTotal.subtotal);
        this.steps = steps;
        this.metadata = checkout.metadata;
        this.paymentSources = checkout.sources; // TODO if secure code, only return last four
        this.createdDate = nowInDbPrecision();
        this.calculateTotalsFromLineItems();
    }

    calculateTotalsFromLineItems(): void {
        this.totals = {
            subtotal: 0,
            tax: 0,
            discount: 0,
            payable: 0,
            remainder: 0,
        };
        for (const item of this.lineItems) {
            item.lineTotal.payable = item.lineTotal.subtotal + item.lineTotal.tax - item.lineTotal.discount;
            this.totals.subtotal += item.lineTotal.subtotal;
            this.totals.tax += item.lineTotal.tax;
            this.totals.discount += item.lineTotal.discount;
            this.totals.payable += item.lineTotal.payable;
        }
        for (const item of this.lineItems) {
            this.totals.remainder += item.lineTotal.remainder;
        }

        this.calculateMarketplaceTotals();
    }

    private calculateMarketplaceTotals(): void {
        if (!this.lineItems || !this.lineItems.find(lineItem => lineItem.marketplaceRate !== undefined)) {
            // Marketplace totals are only set if an item has a marketplaceRate.
            this.totals.marketplace = undefined;
            return;
        }

        let sellerGross = 0;
        for (const item of this.lineItems) {
            const rate = item.marketplaceRate != null ? item.marketplaceRate : 0;
            sellerGross += (1.0 - rate) * item.unitPrice * (item.quantity || 1);
        }
        sellerGross = bankersRounding(sellerGross, 0);

        let sellerDiscount = 0;
        for (const step of this.steps) {
            if (step.rail === "lightrail" && (step as LightrailTransactionPlanStep).value.discount && (step as LightrailTransactionPlanStep).value.discountSellerLiability) {
                sellerDiscount -= (step as LightrailTransactionPlanStep).amount * (step as LightrailTransactionPlanStep).value.discountSellerLiability;
            }
        }

        this.totals.marketplace = {
            sellerGross: sellerGross,
            sellerDiscount: sellerDiscount,
            sellerNet: sellerGross - sellerDiscount
        };
    }

    calculateTaxAndSetOnLineItems(): void {
        for (let item of this.lineItems) {
            let tax = 0;
            item.lineTotal.taxable = item.lineTotal.subtotal - item.lineTotal.discount;
            if (item.taxRate >= 0) {
                tax = bankersRounding(item.taxRate * item.lineTotal.taxable, 0);
            }
            item.lineTotal.tax = tax;
            item.lineTotal.remainder += tax;
        }
    }
}

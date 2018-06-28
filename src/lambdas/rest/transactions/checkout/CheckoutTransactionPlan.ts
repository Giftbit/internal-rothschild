import {TransactionPlan, TransactionPlanStep} from "../TransactionPlan";
import {CheckoutRequest, TransactionParty} from "../../../../model/TransactionRequest";
import {LineItemResponse} from "../../../../model/LineItem";
import {TransactionPlanTotals, TransactionType} from "../../../../model/Transaction";
import {bankersRounding} from "../../../utils/moneyUtils";

export class CheckoutTransactionPlan implements TransactionPlan {
    id: string;
    transactionType: TransactionType;
    currency: string;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[] | null;
    paymentSources: TransactionParty[] | null;
    steps: TransactionPlanStep[];
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
        this.calculateTotalsFromLineItems();
    }

    calculateTotalsFromLineItems(): void {
        this.totals = {
            subTotal: 0,
            tax: 0,
            discount: 0,
            payable: 0,
            remainder: 0,
        };
        for (let item of this.lineItems) {
            item.lineTotal.payable = item.lineTotal.subtotal + item.lineTotal.tax - item.lineTotal.discount;
            this.totals.subTotal += item.lineTotal.subtotal;
            this.totals.tax += item.lineTotal.tax;
            this.totals.discount += item.lineTotal.discount;
            this.totals.payable += item.lineTotal.payable;
        }
        for (const item of this.lineItems) {
            this.totals.remainder += item.lineTotal.remainder;
        }
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
import {LineItemResponse} from "../../../model/LineItem";
import {TransactionTotals} from "../../../model/Transaction";
import {Rule} from "../../../model/Value";
import {getRuleFromCache} from "./getRuleFromCache";

export class RuleContext {
    currentLineItem: LineItemResponse;
    totals: TransactionTotals;
    lineItems: LineItemResponse[];

    constructor(totals: TransactionTotals, lineItems: LineItemResponse[], currentLineItem: LineItemResponse) {
        this.currentLineItem = currentLineItem;
        this.totals = totals;
        this.lineItems = lineItems;
    }

    evaluateValueRule(valueRule: Rule): number {
        return getRuleFromCache(valueRule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(valueRule: Rule): boolean {
        return getRuleFromCache(valueRule.rule).evaluateToBoolean(this);
    }
}
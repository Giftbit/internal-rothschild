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

    evaluateBalanceRule(rule: Rule): number {
        return getRuleFromCache(rule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(rule: Rule): boolean {
        return getRuleFromCache(rule.rule).evaluateToBoolean(this);
    }
}
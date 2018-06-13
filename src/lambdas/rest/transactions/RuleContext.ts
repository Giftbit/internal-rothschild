import {LineItemResponse} from "../../../model/LineItem";
import {TransactionTotal} from "../../../model/Transaction";
import {TransactionPlan} from "./TransactionPlan";
import {Rule} from "../../../model/Value";
import {getRuleFromCache} from "./getRuleFromCache";

export class RuleContext {
    currentLineItem: LineItemResponse;
    totals: TransactionTotal;
    lineItems: LineItemResponse[];

    constructor(transactionPlan: TransactionPlan, currentLineItem: LineItemResponse) {
        this.currentLineItem = currentLineItem;
        this.totals = transactionPlan.totals;
        this.lineItems = transactionPlan.lineItems;
    }

    evaluateValueRule(valueRule: Rule): number {
        return getRuleFromCache(valueRule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(valueRule: Rule): boolean {
        return getRuleFromCache(valueRule.rule).evaluateToBoolean(this);
    }
}
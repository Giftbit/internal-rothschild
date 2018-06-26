import {LineItemResponse} from "../../../model/LineItem";
import {TransactionPlanTotals} from "../../../model/Transaction";
import {Rule} from "../../../model/Value";
import {getRuleFromCache} from "./getRuleFromCache";

export class RuleContext {
    currentLineItem: LineItemResponse;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[];

    constructor(totals: TransactionPlanTotals, lineItems: LineItemResponse[], currentLineItem: LineItemResponse) {
        this.currentLineItem = currentLineItem;
        this.totals = totals;
        this.lineItems = lineItems;
    }

    evaluateValueRule(valueRule: Rule): number {
        const here = getRuleFromCache(valueRule.rule).evaluateToNumber(this);
        ;
        console.log("\n\n\nHERE: " + here);
        return here;
    }

    evaluateRedemptionRule(valueRule: Rule): boolean {
        return getRuleFromCache(valueRule.rule).evaluateToBoolean(this);
    }
}
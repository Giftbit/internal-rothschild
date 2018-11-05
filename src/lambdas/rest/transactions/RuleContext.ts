import {LineItemResponse} from "../../../model/LineItem";
import {TransactionTotals} from "../../../model/Transaction";
import {Rule} from "../../../model/Value";
import {getRuleFromCache} from "./getRuleFromCache";

export interface RuleContextParams {
    totals: TransactionTotals;
    lineItems: LineItemResponse[];
    currentLineItem: LineItemResponse;
    metadata: object;
}

export class RuleContext {
    currentLineItem: LineItemResponse;
    totals: TransactionTotals;
    lineItems: LineItemResponse[];
    metadata: object;

    constructor(params: RuleContextParams) {
        this.currentLineItem = params.currentLineItem;
        this.totals = params.totals;
        this.lineItems = params.lineItems;
        this.metadata = params.metadata;

        console.log("rule metadata=", params.metadata);
    }

    evaluateBalanceRule(rule: Rule): number {
        return getRuleFromCache(rule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(rule: Rule): boolean {
        return getRuleFromCache(rule.rule).evaluateToBoolean(this);
    }
}

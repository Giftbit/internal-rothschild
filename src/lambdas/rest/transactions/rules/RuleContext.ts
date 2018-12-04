import {LineItemResponse} from "../../../../model/LineItem";
import {TransactionTotals} from "../../../../model/Transaction";
import {Rule} from "../../../../model/Value";
import {getRuleFromCache} from "../getRuleFromCache";
import {RuleFunction} from "giftbit-ruleslib/distjs/functions/RuleFunction";
import {ValueContext} from "./ValueContext";

export interface RuleContextParams {
    totals: TransactionTotals;
    lineItems: LineItemResponse[];
    currentLineItem: LineItemResponse;
    metadata: object;
    value: ValueContext;
}

export class RuleContext {
    static readonly customFunctions: { [name: string]: RuleFunction } = {
        // amount: new Amount()
    };

    currentLineItem: LineItemResponse;
    totals: TransactionTotals;
    lineItems: LineItemResponse[];
    metadata: object;
    value: ValueContext;

    constructor(params: RuleContextParams) {
        this.currentLineItem = params.currentLineItem;
        this.totals = params.totals;
        this.lineItems = params.lineItems;
        this.metadata = params.metadata;
        this.value = params.value;
    }

    evaluateBalanceRule(rule: Rule): number {
        return getRuleFromCache(rule.rule).evaluateToNumber(this, RuleContext.customFunctions);
    }

    evaluateRedemptionRule(rule: Rule): boolean {
        return getRuleFromCache(rule.rule).evaluateToBoolean(this, RuleContext.customFunctions);
    }
}
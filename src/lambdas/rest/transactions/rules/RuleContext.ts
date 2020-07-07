import {LineItemResponse} from "../../../../model/LineItem";
import {TransactionTotals} from "../../../../model/Transaction";
import {Rule} from "../../../../model/Value";
import {getRuleFromCache} from "../getRuleFromCache";
import {ValueContext} from "./ValueContext";
import * as cassava from "cassava";
import {discountSellerLiabilityUtils} from "../../../../utils/discountSellerLiabilityUtils";

export interface RuleContextParams {
    totals: TransactionTotals;
    lineItems: LineItemResponse[];
    currentLineItem: LineItemResponse;
    metadata: object;
    value: ValueContext;
}

export class RuleContext {
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
        return getRuleFromCache(rule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(rule: Rule): boolean {
        return getRuleFromCache(rule.rule).evaluateToBoolean(this);
    }

    evaluateDiscountSellerLiabilityRule(rule: Rule): number {
        return getRuleFromCache(rule.rule).evaluateToNumber(this);
    }
}

export function checkRulesSyntax(holder: { redemptionRule?: Rule, balanceRule?: Rule, discountSellerLiabilityRule?: Rule }, holderType: "Value" | "Program"): void {
    if (holder.balanceRule) {
        const rule = getRuleFromCache(holder.balanceRule.rule);
        if (rule.compileError) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `${holderType} balanceRule has a syntax error.`, {
                messageCode: "BalanceRuleSyntaxError",
                syntaxErrorMessage: rule.compileError.msg,
                row: rule.compileError.row,
                column: rule.compileError.column
            });
        }
    }
    if (holder.redemptionRule) {
        const rule = getRuleFromCache(holder.redemptionRule.rule);
        if (rule.compileError) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `${holderType} redemptionRule has a syntax error.`, {
                messageCode: "RedemptionRuleSyntaxError",
                syntaxErrorMessage: rule.compileError.msg,
                row: rule.compileError.row,
                column: rule.compileError.column
            });
        }
    }
    if (holder.discountSellerLiabilityRule) {
        const rule = getRuleFromCache(holder.discountSellerLiabilityRule.rule);
        if (rule.compileError) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `${holderType} discountSellerLiabilityRule has a syntax error.`, {
                messageCode: "DiscountSellerLiabilityRuleSyntaxError",
                syntaxErrorMessage: rule.compileError.msg,
                row: rule.compileError.row,
                column: rule.compileError.column
            });
        }
        discountSellerLiabilityUtils.checkNumericOnlyRuleConstraints(holder.discountSellerLiabilityRule);
    }
}

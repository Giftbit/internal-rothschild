import {LineItemResponse} from "../../../model/LineItem";
import {TransactionPlanTotals} from "../../../model/Transaction";
import {Rule} from "../../../model/Value";
import {getRuleFromCache} from "./getRuleFromCache";

export class RuleContext {
    currentLineItem: LineItemResponse;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[];
    date: DateContext;

    constructor(totals: TransactionPlanTotals, lineItems: LineItemResponse[], currentLineItem: LineItemResponse) {
        this.currentLineItem = currentLineItem;
        this.totals = totals;
        this.lineItems = lineItems;
        const now = new Date();
        this.date = {
            // todo - this is a nice idea but majorly suffers from timezone problems...
            dayOfWeek: DAYS_OF_THE_WEEK[now.getDay()],
            minuteOfDay: now.getMinutes()
        };
    }

    evaluateValueRule(valueRule: Rule): number {
        return getRuleFromCache(valueRule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(valueRule: Rule): boolean {
        return getRuleFromCache(valueRule.rule).evaluateToBoolean(this);
    }
}

const DAYS_OF_THE_WEEK: DateContext["dayOfWeek"][] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface DateContext {
    dayOfWeek: "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
    minuteOfDay: number;
}
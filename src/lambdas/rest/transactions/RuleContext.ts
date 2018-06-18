import {LineItemResponse} from "../../../model/LineItem";
import {TransactionPlanTotals} from "../../../model/Transaction";
import {Rule} from "../../../model/Value";
import {getRuleFromCache} from "./getRuleFromCache";
import * as moment from "moment-timezone";

export class RuleContext {
    currentLineItem: LineItemResponse;
    totals: TransactionPlanTotals;
    lineItems: LineItemResponse[];
    date: DateContext;

    constructor(totals: TransactionPlanTotals, lineItems: LineItemResponse[], currentLineItem: LineItemResponse) {
        this.currentLineItem = currentLineItem;
        this.totals = totals;
        this.lineItems = lineItems;
        const eastern = moment().tz("America/New_York");
        const central = moment().tz("America/North_Dakota/Center");
        const mountain = moment().tz("America/Edmonton");
        const pacific = moment().tz("America/Los_Angeles");
        this.date = {
            EST: {
                dayOfWeek: WEEK_DAYS[eastern.day()].toString(),
                hourOfDay: eastern.hour(),
                minuteOfDay: eastern.minute()
            },
            CEN: {
                dayOfWeek: WEEK_DAYS[central.day()].toString(),
                hourOfDay: central.hour(),
                minuteOfDay: central.minute()
            },
            GMT: {
                dayOfWeek: WEEK_DAYS[mountain.day()].toString(),
                hourOfDay: mountain.hour(),
                minuteOfDay: mountain.minute()
            },
            PST: {
                dayOfWeek: WEEK_DAYS[pacific.day()].toString(),
                hourOfDay: pacific.hour(),
                minuteOfDay: pacific.minute()
            }
        };
    }

    evaluateValueRule(valueRule: Rule): number {
        return getRuleFromCache(valueRule.rule).evaluateToNumber(this);
    }

    evaluateRedemptionRule(valueRule: Rule): boolean {
        return getRuleFromCache(valueRule.rule).evaluateToBoolean(this);
    }
}

const WEEK_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

interface DateContext {
    EST: DateInfo,
    CEN: DateInfo,
    GMT: DateInfo,
    PST: DateInfo,

}

interface DateInfo {
    dayOfWeek: string,
    hourOfDay: number,
    minuteOfDay: number
}
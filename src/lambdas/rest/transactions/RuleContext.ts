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
            eastern: {
                dayOfWeek: WEEK_DAYS[eastern.day()].toString(),
                hourOfDay: eastern.hour(),
                minuteOfDay: eastern.minute()
            },
            central: {
                dayOfWeek: WEEK_DAYS[central.day()].toString(),
                hourOfDay: central.hour(),
                minuteOfDay: central.minute()
            },
            mountain: {
                dayOfWeek: WEEK_DAYS[mountain.day()].toString(),
                hourOfDay: mountain.hour(),
                minuteOfDay: mountain.minute()
            },
            pacific: {
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
    eastern: DateInfo;
    central: DateInfo;
    mountain: DateInfo;
    pacific: DateInfo;
}

interface DateInfo {
    dayOfWeek: string;
    hourOfDay: number;
    minuteOfDay: number;
}
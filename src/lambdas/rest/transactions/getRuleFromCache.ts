import LRU = require("lru-cache");
import {Rule} from "giftbit-ruleslib/distjs/Rule";

let cache: LRU.Cache<string, Rule> = null;
const cacheSize = parseInt(process.env["RULE_CACHE_SIZE"], 10) || 100;

export function getRuleFromCache(expression: string): Rule {
    if (!cache) {
        cache = LRU<string, Rule>({
            max: cacheSize,
            maxAge: Number.POSITIVE_INFINITY
        });
    }

    // this probably isn't where this should go but it's a start as a common location that rules go through.
    // code needs to be extracted / made more resuable but this gives the idea
    expression = expression.replace(/credit\([0-9]*\)/g, (value): string => {
        const creditAmount = value.substring(value.indexOf("(") + 1, value.indexOf(")"));
        return `${creditAmount} + currentStep.amount`;
    });

    let rule = cache.get(expression);
    if (rule === undefined) {
        rule = new Rule(expression || "");
        cache.set(expression, rule);
    }
    return rule;
}

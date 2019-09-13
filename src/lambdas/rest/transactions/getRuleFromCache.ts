import LRU = require("lru-cache");
import {Rule} from "giftbit-ruleslib/distjs/Rule";

let cache: LRU.Cache<string, Rule> = null;
const cacheSize = parseInt(process.env["RULE_CACHE_SIZE"], 10) || 100;

export function getRuleFromCache(expression: string): Rule {
    if (!cache) {
        cache = new LRU<string, Rule>({
            max: cacheSize,
            maxAge: Number.POSITIVE_INFINITY
        });
    }

    let rule = cache.get(expression);
    if (rule === undefined) {
        rule = new Rule(expression || "");
        cache.set(expression, rule);
    }
    return rule;
}

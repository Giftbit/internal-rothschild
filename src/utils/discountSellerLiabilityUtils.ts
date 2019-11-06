import {Rule} from "../model/Value";

/*
 * This Utils can be removed when discountSellerLiability is removed from the API and
 * is supported via discountSellerLiabilityRule.
 */
export namespace DiscountSellerLiabilityUtils {

    /*
     * If discountSellerLiabilityRule can directly correspond to a number this will return a number.
     * Otherwise, returns null since discountSellerLiabilityRule is either a rule or null.
     */
    export function ruleToNumber(discountSellerLiabilityRule: Rule | null): number | null {
        if (!discountSellerLiabilityRule || isNaN(+discountSellerLiabilityRule.rule)) {
            return null;
        } else {
            return +discountSellerLiabilityRule.rule;
        }
    }


    export function numberToRule(discountSellerLiability: number | null): Rule | null {
        if (discountSellerLiability != null) {
            return {
                rule: `${discountSellerLiability}`,
                explanation: `Seller ${discountSellerLiability * 100}% liable`
            };
        } else {
            return null;
        }
    }
}

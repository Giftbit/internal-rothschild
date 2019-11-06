import {Rule} from "../model/Value";
import * as cassava from "cassava";

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

    /*
     * If the rule corresponds directly to a number, throw an error if it is outside of [0, 1].
     */
    export function checkNumericOnlyRuleConstraints(discountSellerLiabilityRule: Rule | null): void {
        const discountSellerLiability: null | number = DiscountSellerLiabilityUtils.ruleToNumber(discountSellerLiabilityRule);
        if (discountSellerLiability != null && (discountSellerLiability < 0 || discountSellerLiability > 1)) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Property discountSellerLiabilityRule must evaluate to a number between 0 and 1.`, {
                messageCode: "DiscountSellerLiabilityRuleSyntaxError"
            });
        }
    }
}

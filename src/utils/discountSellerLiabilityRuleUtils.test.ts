import * as chai from "chai";
import {DiscountSellerLiabilityUtils} from "./discountSellerLiabilityUtils";
import {Rule, Value} from "../model/Value";

describe("DiscountSellerLiabibilityRuleUtils", () => {
    describe("discountSellerLiabilityRuleToNumber", () => {
        it("returns null if null", async () => {
            const res = DiscountSellerLiabilityUtils.ruleToNumber(null);
            chai.assert.isNull(res);
        });

        it("returns number from string that evaluates to number", async () => {
            const res = DiscountSellerLiabilityUtils.ruleToNumber({
                rule: "0.05",
                explanation: "5%"
            });
            chai.assert.equal(res, 0.05);
        });

        it("returns null from a rule", async () => {
            const res = DiscountSellerLiabilityUtils.ruleToNumber({
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional shared with marketplace"
            });
            chai.assert.isNull(res);
        });
    });

    describe("discountSellerLiabilityToRule", () => {
        it("returns null if null", async () => {
            const v: Partial<Value> = {};
            const res: Rule | null = DiscountSellerLiabilityUtils.numberToRule(null);
            chai.assert.isNull(res);
        });

        it("converts discountSellerLiability to rule", async () => {
            const v: Partial<Value> = {
                discountSellerLiability: 0.45
            };
            const res: Rule | null = DiscountSellerLiabilityUtils.numberToRule(0.45);
            chai.assert.deepEqual(res, {
                rule: "0.45",
                explanation: ""
            });
        });
    });
});
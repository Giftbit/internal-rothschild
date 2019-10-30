import * as chai from "chai";
import {discountSellerLiabilityRuleToNumber, discountSellerLiabilityToRule, Rule, Value} from "../Value";

describe("Value", () => {
    describe("discountSellerLiabilityRuleToNumber", () => {
        it("returns null if null", async () => {
            const res = discountSellerLiabilityRuleToNumber(null);
            chai.assert.isNull(res);
        });

        it("returns number from string that evaluates to number", async () => {
            const res = discountSellerLiabilityRuleToNumber({
                rule: "0.05",
                explanation: "5%"
            });
            chai.assert.equal(res, 0.05);
        });

        it("returns null from a rule", async () => {
            const res = discountSellerLiabilityRuleToNumber({
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional shared with marketplace"
            });
            chai.assert.isNull(res);
        });
    });

    describe("discountSellerLiabilityToRule", () => {
        it("returns null if null", async () => {
            const v: Partial<Value> = {};
            const res: Rule | null = discountSellerLiabilityToRule(null);
            chai.assert.isNull(res);
        });

        it("converts discountSellerLiability to rule", async () => {
            const v: Partial<Value> = {
                discountSellerLiability: 0.45
            };
            const res: Rule | null = discountSellerLiabilityToRule(0.45);
            chai.assert.deepEqual(res, {
                rule: "0.45",
                explanation: ""
            });
        });
    });
});
import * as chai from "chai";
import {discountSellerLiabilityUtils} from "./discountSellerLiabilityUtils";
import {Rule} from "../model/Value";

describe("discountSellerLiabibilityRuleUtils", () => {
    describe("ruleToNumber()", () => {
        it("returns null if null", async () => {
            const res = discountSellerLiabilityUtils.ruleToNumber(null);
            chai.assert.isNull(res);
        });

        it("returns number from string that evaluates to number", async () => {
            const res = discountSellerLiabilityUtils.ruleToNumber({
                rule: "0.05",
                explanation: "5%"
            });
            chai.assert.equal(res, 0.05);
        });

        it("returns null from a rule", async () => {
            const res = discountSellerLiabilityUtils.ruleToNumber({
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional shared with marketplace"
            });
            chai.assert.isNull(res);
        });
    });

    describe("numberToRule()", () => {
        it("returns null if null", async () => {
            const res: Rule | null = discountSellerLiabilityUtils.numberToRule(null);
            chai.assert.isNull(res);
        });

        it("converts discountSellerLiability to rule", async () => {
            const res: Rule | null = discountSellerLiabilityUtils.numberToRule(0.45);
            chai.assert.deepEqual(res, {
                rule: "0.45",
                explanation: "Seller 45% liable"
            });
        });
    });
});

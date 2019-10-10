import * as chai from "chai";
import {formatDiscountSellerLiabilityRuleForLegacySupport} from "../Value";

describe("Value", () => {
    describe("formatDiscountSellerLiabilityRuleForLegacySupport", () => {
        it("returns null if null", async () => {
            const res = formatDiscountSellerLiabilityRuleForLegacySupport(null);
            chai.assert.isNull(res);
        });

        it("returns number from string that evaluates to number", async () => {
            const res = formatDiscountSellerLiabilityRuleForLegacySupport({
                rule: "0.05",
                explanation: "5%"
            });
            chai.assert.equal(res, 0.05);
        });

        it("returns null from a rule", async () => {
            const res = formatDiscountSellerLiabilityRuleForLegacySupport({
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional shared with marketplace"
            });
            chai.assert.isNull(res);
        });
    });
});
import * as chai from "chai";
import {formatDiscountSellerLiability} from "../Value";

describe("Value model tests", () => {
    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability(null);
        chai.assert.isNull(res);
    });

    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability("0.05");
        chai.assert.equal(res, 0.05);
    });

    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability("1 - currentLineItem.marketplaceRate");
        chai.assert.equal(res, "1 - currentLineItem.marketplaceRate");
    });

    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability("0.05 + 0.02");
        chai.assert.equal(res, "0.05 + 0.02");
    });
});
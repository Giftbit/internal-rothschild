import * as chai from "chai";
import {formatDiscountSellerLiability} from "../Value";

describe("Value model tests", () => {
    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability(null);
        console.log(res);
        chai.assert.isNull(res);
    });

    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability("0.05");
        console.log(res);
        chai.assert.equal(res, 0.05);
    });

    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability("1 - currentLineItem.marketplaceRate");
        console.log(res);
        chai.assert.equal(res, "1 - currentLineItem.marketplaceRate");
    });

    it("can get discountSellerLiability from string", async () => {
        const res = formatDiscountSellerLiability("0.05 + 0.02");
        console.log(res);
        chai.assert.equal(res, "0.05 + 0.02");
    });
});
import {describe, it, before} from "mocha";
import * as currencies from "../../currencies";
import * as testUtils from "../../../../testUtils";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {installRestRoutes} from "../../installRestRoutes";
import {defaultTestUser} from "../../../../testUtils";
import {Value} from "../../../../model/Value";
import * as chai from "chai";
import {Transaction} from "../../../../model/Transaction";

describe("/v2/transactions/checkout - marketplaceRate", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);

        await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    let value: Value;

    it("allows marketplaceRate to be set on every item", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "marketplace-test-gift-card",
            currency: "CAD",
            balance: 95000
        });
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);
        value = postValueResp.body;

        const checkoutRequest = {
            id: "checkout-1",
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "cheeseburger",
                    unitPrice: 1299,
                    taxRate: 0.05,
                    marketplaceRate: 0.2
                },
                {
                    type: "product",
                    productId: "fries",
                    unitPrice: 399,
                    quantity: 2,
                    taxRate: 0.05,
                    marketplaceRate: 0.2,
                },
                {
                    type: "fee",
                    productId: "commission-fee",
                    unitPrice: 200,
                    taxRate: 0.15,
                    marketplaceRate: 1
                }
            ],
            currency: "CAD"
        };
        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.equal(checkoutResp.body.totals.tax, 135);
        chai.assert.deepEqual(checkoutResp.body.totals.marketplace, {
            sellerGross: 1678,
            sellerDiscount: 0,
            sellerNet: 1678
        });
    });

    it("allows marketplaceRate to be left off, and assumed to be 0", async () => {
        const checkoutRequest = {
            id: "checkout-2",
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "cheeseburger",
                    unitPrice: 1299,
                    taxRate: 0.05,
                    marketplaceRate: 0.2
                },
                {
                    type: "product",
                    productId: "fries",
                    unitPrice: 399,
                    quantity: 2,
                    taxRate: 0.05,
                    marketplaceRate: 0.2,
                },
                {
                    type: "product",
                    productId: "flavored-sugar-water",
                    unitPrice: 249,
                    quantity: 2,
                    taxRate: 0.25
                },
                {
                    type: "fee",
                    productId: "commission-fee",
                    unitPrice: 200,
                    taxRate: 0.15,
                    marketplaceRate: 1
                }
            ],
            currency: "CAD"
        };
        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.equal(checkoutResp.body.totals.tax, 259);
        chai.assert.deepEqual(checkoutResp.body.totals.marketplace, {
            sellerGross: 2176,
            sellerDiscount: 0,
            sellerNet: 2176
        });
    });

    let sellerDiscountValue: Value;

    it("removes discountSellerLiability=1.0 from the seller net", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "marketplace-seller-discount",
            currency: "CAD",
            discount: true,
            discountSellerLiability: 1.0,
            balance: 500,
            pretax: true
        });
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);
        sellerDiscountValue = postValueResp.body;

        const checkoutRequest = {
            id: "checkout-3",
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "lightrail",
                    valueId: sellerDiscountValue.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "adventure",
                    unitPrice: 20000,
                    taxRate: 0.15,
                    marketplaceRate: 0.2
                },
                {
                    type: "fee",
                    productId: "commission-fee",
                    unitPrice: 1200,
                    taxRate: 0.15,
                    marketplaceRate: 1
                }
            ],
            currency: "CAD"
        };
        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.equal(checkoutResp.body.totals.tax, 3105);
        chai.assert.deepEqual(checkoutResp.body.totals.marketplace, {
            sellerGross: 16000,
            sellerDiscount: 500,
            sellerNet: 15500
        });
    });

    it("removes discountSellerLiability=0.5 from the seller net", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "marketplace-seller-half-discount",
            currency: "CAD",
            discount: true,
            discountSellerLiability: 0.5,
            balance: 500,
            pretax: true
        });
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);
        sellerDiscountValue = postValueResp.body;

        const checkoutRequest = {
            id: "checkout-4",
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "lightrail",
                    valueId: sellerDiscountValue.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "adventure",
                    unitPrice: 20000,
                    taxRate: 0.15,
                    marketplaceRate: 0.2
                },
                {
                    type: "fee",
                    productId: "commission-fee",
                    unitPrice: 1200,
                    taxRate: 0.15,
                    marketplaceRate: 1
                }
            ],
            currency: "CAD"
        };
        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.equal(checkoutResp.body.totals.tax, 3105);
        chai.assert.deepEqual(checkoutResp.body.totals.marketplace, {
            sellerGross: 16000,
            sellerDiscount: 250,
            sellerNet: 15750
        });
    });
});

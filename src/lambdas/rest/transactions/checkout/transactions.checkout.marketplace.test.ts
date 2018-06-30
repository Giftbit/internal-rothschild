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

describe.only("/v2/transactions/checkout - marketplaceCommissionRate", () => {

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

    it("allows marketplaceCommissionRate to be set on every item", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "marketplace-test-gift-card",
            currency: "CAD",
            balance: 65000
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
                    marketplaceCommissionRate: 0.2
                },
                {
                    type: "product",
                    productId: "fries",
                    unitPrice: 399,
                    quantity: 2,
                    taxRate: 0.05,
                    marketplaceCommissionRate: 0.2,
                },
                {
                    type: "fee",
                    productId: "commission-fee",
                    unitPrice: 200,
                    taxRate: 0.15,
                    marketplaceCommissionRate: 1
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

    it("allows marketplaceCommissionRate to be left off, and assumed to be 0", async () => {
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
                    marketplaceCommissionRate: 0.2
                },
                {
                    type: "product",
                    productId: "fries",
                    unitPrice: 399,
                    quantity: 2,
                    taxRate: 0.05,
                    marketplaceCommissionRate: 0.2,
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
                    marketplaceCommissionRate: 1
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
});

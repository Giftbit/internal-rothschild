import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../../utils/testUtils";
import {Value} from "../../../../model/Value";
import {Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/checkout - simulation tests", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Tire Money",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("test simulation with gift card and pretax promotion", async () => {
        const giftCard: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 4000
        };
        const preTaxPromotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 500,
            pretax: true,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotion1Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", preTaxPromotion);
        chai.assert.equal(createPromotion1Resp.statusCode, 201, `body=${JSON.stringify(createPromotion1Resp.body)}`);

        let request: any = {
            id: generateId(),
            simulate: true,
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                },
                {
                    rail: "lightrail",
                    valueId: preTaxPromotion.id
                }
            ],
            lineItems: [
                {
                    type: "shipping",
                    productId: "p1",
                    unitPrice: 5059,
                    quantity: 1,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 2999,
                    quantity: 11,
                    taxRate: 0.08
                }
            ],
            currency: "CAD"
        };
        const checkoutResponse = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(checkoutResponse.statusCode, 200, `body=${JSON.stringify(checkoutResponse.body)}`);
        chai.assert.deepEqualExcluding(checkoutResponse.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 38048,
                "tax": 2852,
                "discount": 500,
                "discountLightrail": 500,
                "payable": 40400,
                "paidInternal": 0,
                "paidLightrail": 4000,
                "paidStripe": 0,
                "remainder": 36400
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 2999,
                    "quantity": 11,
                    "taxRate": 0.08,
                    "lineTotal": {
                        "subtotal": 32989,
                        "taxable": 32489,
                        "tax": 2599,
                        "discount": 500,
                        "remainder": 31088,
                        "payable": 35088
                    }
                },
                {
                    "type": "shipping",
                    "productId": "p1",
                    "unitPrice": 5059,
                    "quantity": 1,
                    "taxRate": 0.05,
                    "lineTotal": {
                        "subtotal": 5059,
                        "taxable": 5059,
                        "tax": 253,
                        "discount": 0,
                        "remainder": 5312,
                        "payable": 5312
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": preTaxPromotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 500,
                    "balanceAfter": 0,
                    "balanceChange": -500,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                },
                {
                    "rail": "lightrail",
                    "valueId": giftCard.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 4000,
                    "balanceAfter": 0,
                    "balanceChange": -4000,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": giftCard.id
                },
                {
                    "rail": "lightrail",
                    "valueId": preTaxPromotion.id
                }
            ],
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId,
        }, ["createdDate", "createdBy"]);

        const giftCardBalance = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(giftCardBalance.statusCode, 200, `body=${JSON.stringify(giftCardBalance.body)}`);
        chai.assert.equal(giftCardBalance.body.balance, 4000);

        const promotionBalance = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${preTaxPromotion.id}`, "GET");
        chai.assert.equal(promotionBalance.statusCode, 200, `body=${JSON.stringify(promotionBalance.body)}`);
        chai.assert.equal(promotionBalance.body.balance, 500);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-1", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 404, `body=${JSON.stringify(getCheckoutResp.body)}`);
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values/values";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../../utils/testUtils";
import {Value} from "../../../../model/Value";
import {getRuleFromCache} from "../getRuleFromCache";
import {createCurrency} from "../../currencies";
import {Transaction} from "../../../../model/Transaction";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../../utils/dbUtils";

chai.use(chaiExclude);

describe("/v2/transactions/checkout - balanceRule and redemptionRule", () => {

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
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
        });
    });

    it("balanceRule evaluates to a number", async () => {
        const promotion: Partial<Value> = {
            id: "test balanceRule",
            currency: "CAD",
            balanceRule: {
                rule: "total*{rates: [0.5]}.rates[0]",
                explanation: "testing it out!"
            },
            pretax: true,
            discount: true
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        const result: number = getRuleFromCache(promotion.balanceRule.rule).evaluateToNumber({total: 50});
        chai.assert.equal(result, 25, `expected result to equal ${25}`);
    });

    it("basic 50% off everything", async () => {
        const promotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal*0.5",
                explanation: "50% off everything"
            },
            pretax: true,
            discount: true
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: promotion.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.10
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 250,
                    quantity: 2,
                    taxRate: 0.10
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 1000,
                "tax": 50,
                "discount": 500,
                "discountLightrail": 500,
                "payable": 550,
                "paidInternal": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 550,
                "forgiven": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 500,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 500,
                        "taxable": 250,
                        "tax": 25,
                        "discount": 250,
                        "remainder": 275,
                        "payable": 275
                    }
                },
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 250,
                    "quantity": 2,
                    "taxRate": 0.1,
                    "lineTotal": {
                        "subtotal": 500,
                        "taxable": 250,
                        "tax": 25,
                        "discount": 250,
                        "remainder": 275,
                        "payable": 275
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -500,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate", "createdBy"]);
    });

    it("basic 25% off select item", async () => {
        const promotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.25",
                explanation: "25% off line item"
            },
            redemptionRule: {
                rule: "currentLineItem.productId == 'p1'",
                explanation: "product must be have productId p1"
            },
            pretax: true,
            discount: true
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: promotion.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.10
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 250,
                    quantity: 2,
                    taxRate: 0.10
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 1000,
                "tax": 88,
                "discount": 125,
                "discountLightrail": 125,
                "payable": 963,
                "paidInternal": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 963,
                "forgiven": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 500,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 500,
                        "taxable": 375,
                        "tax": 38,
                        "discount": 125,
                        "remainder": 413,
                        "payable": 413
                    }
                },
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 250,
                    "quantity": 2,
                    "taxRate": 0.1,
                    "lineTotal": {
                        "subtotal": 500,
                        "taxable": 500,
                        "tax": 50,
                        "discount": 0,
                        "remainder": 550,
                        "payable": 550
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -125,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
    });

    it("basic 10% off everything, and 20% off product promotion. ensure promotions don't stack and 20% is used.", async () => {
        const cartPromotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.1",
                explanation: "10% off everything"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.discount == 0",
                explanation: "limited to 1 promotion per item"
            },
            pretax: true,
            discount: true
        };

        const productPromotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.2",
                explanation: "20% off p1"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.discount == 0 && currentLineItem.productId == 'p1'",
                explanation: "limited to 1 promotion per item"
            },
            pretax: true,
            discount: true
        };

        const respCartPromo = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", cartPromotion);
        chai.assert.equal(respCartPromo.statusCode, 201, `body=${JSON.stringify(respCartPromo.body)}`);

        const respProductPromo = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", productPromotion);
        chai.assert.equal(respProductPromo.statusCode, 201, `body=${JSON.stringify(respProductPromo.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: cartPromotion.id
                },
                {
                    rail: "lightrail",
                    valueId: productPromotion.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.10
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 250,
                    quantity: 1,
                    taxRate: 0.10
                }
            ],
            currency: "CAD"
        };

        const postOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 750,
                "tax": 62,
                "discount": 125,
                "discountLightrail": 125,
                "payable": 687,
                "paidInternal": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 687,
                "forgiven": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 500,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 500,
                        "taxable": 400,
                        "tax": 40,
                        "discount": 100,
                        "remainder": 440,
                        "payable": 440
                    }
                },
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 250,
                    "quantity": 1,
                    "taxRate": 0.1,
                    "lineTotal": {
                        "subtotal": 250,
                        "taxable": 225,
                        "tax": 22,
                        "discount": 25,
                        "remainder": 247,
                        "payable": 247
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": productPromotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -100,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                },
                {
                    "rail": "lightrail",
                    "valueId": cartPromotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -25,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": cartPromotion.id
                },
                {
                    "rail": "lightrail",
                    "valueId": productPromotion.id
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
    });

    it("basic 10% off everything, 20% off product promotion, and remainder on gift card. ensure promotions don't stack and 20% is used.", async () => {
        const cartPromotion: Partial<Value> = {
            id: "cp-" + generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.1",
                explanation: "10% off everything"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.discount == 0",
                explanation: "limited to 1 promotion per item"
            },
            pretax: true,
            discount: true
        };

        const productPromotion: Partial<Value> = {
            id: "pp-" + generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.2",
                explanation: "20% off p1"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.discount == 0 && currentLineItem.productId == 'p1'",
                explanation: "limited to 1 promotion per item"
            },
            pretax: true,
            discount: true
        };

        const giftCard1: Partial<Value> = {
            id: "gc-" + generateId(),
            currency: "CAD",
            balance: 800
        };

        const createCartPromo = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", cartPromotion);
        chai.assert.equal(createCartPromo.statusCode, 201, `body=${JSON.stringify(createCartPromo.body)}`);

        const createProductPromo = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", productPromotion);
        chai.assert.equal(createProductPromo.statusCode, 201, `body=${JSON.stringify(createProductPromo.body)}`);

        const createGiftCard1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard1);
        chai.assert.equal(createGiftCard1.statusCode, 201, `body=${JSON.stringify(createGiftCard1.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: cartPromotion.id
                },
                {
                    rail: "lightrail",
                    valueId: productPromotion.id
                },
                {
                    rail: "lightrail",
                    valueId: giftCard1.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 199,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 299,
                    taxRate: 0.07
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 349
                }
            ],
            currency: "CAD"
        };

        const postOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",

            // Note: ideally the 20% off product promotion should happen first which gets the discount
            // up to 105. That's not something our current checkout source ordering does and it's
            // a known gap.  We're thinking it's edge-casey enough people won't notice until we
            // want to revisit it.
            "totals": {
                "subtotal": 847,
                "tax": 28,
                "discount": 85,
                "payable": 790,
                "remainder": 0,
                "forgiven": 0,
                "discountLightrail": 85,
                "paidLightrail": 790,
                "paidStripe": 0,
                "paidInternal": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 349,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 349,
                        "taxable": 314,
                        "tax": 0,
                        "discount": 35,
                        "remainder": 0,
                        "payable": 314
                    }
                },
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 299,
                    "taxRate": 0.07,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 299,
                        "taxable": 269,
                        "tax": 19,
                        "discount": 30,
                        "remainder": 0,
                        "payable": 288
                    }
                },
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 199,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 199,
                        "taxable": 179,
                        "tax": 9,
                        "discount": 20,
                        "remainder": 0,
                        "payable": 188
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": cartPromotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -85,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                },
                {
                    "rail": "lightrail",
                    "valueId": giftCard1.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 800,
                    "balanceAfter": 10,
                    "balanceChange": -790,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": cartPromotion.id
                },
                {
                    "rail": "lightrail",
                    "valueId": productPromotion.id
                },
                {
                    "rail": "lightrail",
                    "valueId": giftCard1.id
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
    });

    it("basic 32% off select item, single use. test it can't be transacted against again.", async () => {
        const promotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.32",
                explanation: "32% off line item"
            },
            redemptionRule: {
                rule: "currentLineItem.productId == 'p1'",
                explanation: "product must be have productId p1"
            },
            pretax: true,
            discount: true,
            usesRemaining: 1
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: promotion.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 1200,
                    taxRate: 0.10
                },
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 1200,
                    taxRate: 0.10
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 2400,
                "tax": 164,
                "discount": 768,
                "discountLightrail": 768,
                "payable": 1796,
                "paidInternal": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 1796,
                "forgiven": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 1200,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 1200,
                        "taxable": 816,
                        "tax": 82,
                        "discount": 384,
                        "remainder": 898,
                        "payable": 898
                    }
                },
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 1200,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 1200,
                        "taxable": 816,
                        "tax": 82,
                        "discount": 384,
                        "remainder": 898,
                        "payable": 898
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -768,
                    "usesRemainingBefore": 1,
                    "usesRemainingAfter": 0,
                    "usesRemainingChange": -1
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const lookupAfterCheckout = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${promotion.id}`, "GET", promotion);
        chai.assert.equal(lookupAfterCheckout.statusCode, 200, `body=${JSON.stringify(lookupAfterCheckout.body)}`);
        chai.assert.equal(lookupAfterCheckout.body.usesRemaining, 0, `body=${JSON.stringify(lookupAfterCheckout.body)}`);

        const checkoutRequestTwo = {
            ...checkoutRequest,
            id: generateId()
        };

        const checkoutResponseTwo = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequestTwo);
        chai.assert.deepEqualExcluding(checkoutResponseTwo.body, {
            "id": checkoutRequestTwo.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 2400,
                "tax": 240,
                "discount": 0,
                "discountLightrail": 0,
                "payable": 2640,
                "paidInternal": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 2640,
                "forgiven": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 1200,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 1200,
                        "taxable": 1200,
                        "tax": 120,
                        "discount": 0,
                        "remainder": 1320,
                        "payable": 1320
                    }
                },
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 1200,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 1200,
                        "taxable": 1200,
                        "tax": 120,
                        "discount": 0,
                        "remainder": 1320,
                        "payable": 1320
                    }
                }
            ],
            "steps": [],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": promotion.id
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
    });

    it("stacking promotions: basic 10% off subtotal, 20% off remainder. ensure promotion that operates on remainder is used first", async () => {
        // promotion off remainder should be applied first.
        const promotion10PercentOffSubtotal: Partial<Value> = {
            id: generateId() + "_p10",
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal*0.1",
                explanation: "10% off everything"
            },
            pretax: true,
            discount: true,
            usesRemaining: 1
        };

        const promotion20PercentOffRemainder: Partial<Value> = {
            id: generateId() + "_p20",
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.remainder*0.2",
                explanation: "20% off everything"
            },
            pretax: true,
            discount: true,
            usesRemaining: 1
        };

        const createPromo10PercentOffSubtotal = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion10PercentOffSubtotal);
        chai.assert.equal(createPromo10PercentOffSubtotal.statusCode, 201, `body=${JSON.stringify(createPromo10PercentOffSubtotal.body)}`);

        const createPromo20PercentOffRemainder = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion20PercentOffRemainder);
        chai.assert.equal(createPromo20PercentOffRemainder.statusCode, 201, `body=${JSON.stringify(createPromo20PercentOffRemainder.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: promotion10PercentOffSubtotal.id
                },
                {
                    rail: "lightrail",
                    valueId: promotion20PercentOffRemainder.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 2399
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 2399,
                "tax": 0,
                "discount": 720,
                "discountLightrail": 720,
                "payable": 1679,
                "paidInternal": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 1679,
                "forgiven": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 2399,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 2399,
                        "taxable": 1679,
                        "tax": 0,
                        "discount": 720,
                        "remainder": 1679,
                        "payable": 1679
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": promotion20PercentOffRemainder.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -480,
                    "usesRemainingBefore": 1,
                    "usesRemainingAfter": 0,
                    "usesRemainingChange": -1
                },
                {
                    "rail": "lightrail",
                    "valueId": promotion10PercentOffSubtotal.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -240,
                    "usesRemainingBefore": 1,
                    "usesRemainingAfter": 0,
                    "usesRemainingChange": -1
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": promotion10PercentOffSubtotal.id
                },
                {
                    "rail": "lightrail",
                    "valueId": promotion20PercentOffRemainder.id
                }
            ],
            "pending": false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
    });

    it("rules can use transaction metadata", async () => {
        // promotion off remainder should be applied first.
        const value1: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal*0.1",
                explanation: "10% off everything"
            },
            redemptionRule: {
                rule: "metadata.isNewClient == true",
                explanation: "new clients only"
            },
            discount: true,
            pretax: true,
            usesRemaining: 1
        };
        const value1Res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(value1Res.statusCode, 201, `body=${JSON.stringify(value1Res.body)}`);

        const value2: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.remainder*0.2",
                explanation: "20% off everything"
            },
            redemptionRule: {
                rule: "metadata.isGoldClient == true",
                explanation: "gold level clients only"
            },
            pretax: true,
            discount: true,
            usesRemaining: 1
        };
        const value2res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(value2res.statusCode, 201, `body=${JSON.stringify(value2res.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: value1.id
                },
                {
                    rail: "lightrail",
                    valueId: value2.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 3999,
                    taxRate: 0.10
                }
            ],
            currency: "CAD",
            metadata: {
                isNewClient: true,
                isGoldClient: false
            }
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "tax": {"roundingMode": "HALF_EVEN"},
            "totals": {
                "subtotal": 3999,
                "tax": 360,
                "discount": 400,
                "payable": 3959,
                "remainder": 3959,
                "forgiven": 0,
                "discountLightrail": 400,
                "paidLightrail": 0,
                "paidStripe": 0,
                "paidInternal": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p1",
                    "unitPrice": 3999,
                    "taxRate": 0.1,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 3999,
                        "taxable": 3599,
                        "tax": 360,
                        "discount": 400,
                        "remainder": 3959,
                        "payable": 3959
                    }
                }
            ],
            "steps": [
                {
                    "balanceAfter": null,
                    "balanceBefore": null,
                    "balanceChange": -400,
                    "code": null,
                    "contactId": null,
                    "rail": "lightrail",
                    "usesRemainingAfter": 0,
                    "usesRemainingBefore": 1,
                    "usesRemainingChange": -1,
                    "valueId": value1.id
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": value1.id
                },
                {
                    "rail": "lightrail",
                    "valueId": value2.id
                }
            ],
            "pending": false,
            "metadata": {
                "isGoldClient": false,
                "isNewClient": true
            },
            "createdBy": defaultTestUser.auth.teamMemberId,
            "createdDate": null
        }, ["createdDate"]);
    });

    it("can discount an amount off cart using value.balanceChange", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "800 + value.balanceChange",
                explanation: "$8 credit"
            },
            discount: true,
            pretax: true,
            usesRemaining: 1
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            lineItems: [
                {
                    unitPrice: 200,
                },
                {
                    unitPrice: 600,
                },
                {
                    unitPrice: 100
                }
            ],
            currency: "CAD",
        };
        const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(createCheckout.statusCode, 201, `body=${JSON.stringify(createCheckout.body)}`);
        chai.assert.deepEqualExcluding(createCheckout.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "createdDate": null,
            "tax": {
                "roundingMode": "HALF_EVEN"
            },
            "totals": {
                "subtotal": 900,
                "tax": 0,
                "discount": 800,
                "payable": 100,
                "remainder": 100,
                "forgiven": 0,
                "discountLightrail": 800,
                "paidLightrail": 0,
                "paidStripe": 0,
                "paidInternal": 0
            },
            "lineItems": [
                {
                    "unitPrice": 600,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 600,
                        "taxable": 0,
                        "tax": 0,
                        "discount": 600,
                        "remainder": 0,
                        "payable": 0
                    }
                },
                {
                    "unitPrice": 200,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 200,
                        "taxable": 0,
                        "tax": 0,
                        "discount": 200,
                        "remainder": 0,
                        "payable": 0
                    }
                },
                {
                    "unitPrice": 100,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 100,
                        "taxable": 100,
                        "tax": 0,
                        "discount": 0,
                        "remainder": 100,
                        "payable": 100
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": value.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -800,
                    "usesRemainingBefore": 1,
                    "usesRemainingAfter": 0,
                    "usesRemainingChange": -1
                }
            ],
            "pending": false,
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": value.id
                }
            ],
            "metadata": null,
            "createdBy": "default-test-user-TEST"
        }, ["createdDate"]);
    });

    it("can't use balanceRule that increases the cost of the item", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "-100",
                explanation: "increase cost of item by $1"
            },
            discount: true,
            pretax: true,
            usesRemaining: 1
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            lineItems: [
                {
                    unitPrice: 200,
                }
            ],
            currency: "CAD",
        };
        const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(createCheckout.statusCode, 201, `body=${JSON.stringify(createCheckout.body)}`);
        chai.assert.deepEqualExcluding(createCheckout.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "createdDate": null,
            "tax": {
                "roundingMode": "HALF_EVEN"
            },
            "totals": {
                "subtotal": 200,
                "tax": 0,
                "discount": 0,
                "payable": 200,
                "remainder": 200,
                "forgiven": 0,
                "discountLightrail": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "paidInternal": 0
            },
            "lineItems": [
                {
                    "unitPrice": 200,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 200,
                        "taxable": 200,
                        "tax": 0,
                        "discount": 0,
                        "remainder": 200,
                        "payable": 200
                    }
                }
            ],
            "steps": [],
            "pending": false,
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": value.id
                }
            ],
            "metadata": null,
            "createdBy": "default-test-user-TEST"
        }, ["createdDate"]);
    });

    it("can use balanceRule that does not evaluate to a number but defaults to 0", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "a",
                explanation: "doesn't evaluate to a number"
            },
            discount: true,
            pretax: true,
            usesRemaining: 1
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            lineItems: [
                {
                    unitPrice: 200,
                }
            ],
            currency: "CAD",
        };
        const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(createCheckout.statusCode, 201, `body=${JSON.stringify(createCheckout.body)}`);
        chai.assert.deepEqualExcluding(createCheckout.body, {
            "id": checkoutRequest.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "createdDate": null,
            "tax": {
                "roundingMode": "HALF_EVEN"
            },
            "totals": {
                "subtotal": 200,
                "tax": 0,
                "discount": 0,
                "payable": 200,
                "remainder": 200,
                "forgiven": 0,
                "discountLightrail": 0,
                "paidLightrail": 0,
                "paidStripe": 0,
                "paidInternal": 0
            },
            "lineItems": [
                {
                    "unitPrice": 200,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 200,
                        "taxable": 200,
                        "tax": 0,
                        "discount": 0,
                        "remainder": 200,
                        "payable": 200
                    }
                }
            ],
            "steps": [],
            "pending": false,
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": value.id
                }
            ],
            "metadata": null,
            "createdBy": "default-test-user-TEST"
        }, ["createdDate"]);
    });

    it("can checkout with a balanceRule that evaluates to a string -> NaN -> 0", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "'string'",
                explanation: "evaluates to a string"
            }
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        const checkout: CheckoutRequest = {
            id: generateId(),
            currency: "CAD",
            sources: [
                {rail: "lightrail", valueId: value.id}
            ],
            lineItems: [{unitPrice: 1}],
            allowRemainder: true
        };
        const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
        chai.assert.equal(createCheckout.statusCode, 201);
        chai.assert.equal(createCheckout.body.totals.remainder, 1);
        chai.assert.equal(createCheckout.body.totals.paidLightrail, 0);
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../values";
import * as currencies from "../currencies";
import * as testUtils from "../../../testUtils";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {Currency} from "../../../model/Currency";
import {getRuleFromCache} from "./getRuleFromCache";

describe("/v2/transactions/order", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        currencies.installCurrenciesRest(router);
    });

    it("processes basic order", async () => {
        const currency: Currency = {
            code: "CAD",
            name: "Monopoly Money",
            symbol: "$",
            decimalPlaces: 2
        };
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const giftCard: Partial<Value> = {
            id: "basic-order-vs",
            // type: "GIFTCARD",
            currency: "CAD",
            balance: 1000
        };

        const postValueStoreResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const request = {
            id: "order-1",
            sources: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 50
                }
            ],
            currency: "CAD"
        };
        const postOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            id: "order-1",
            transactionType: "order",
            currency: "CAD",
            totals: {
                subTotal: 50,
                tax: 0,
                discount: 0,
                payable: 50,
                remainder: 0,
            },
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 50,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 50,
                        taxable: 50,
                        tax: 0,
                        discount: 0,
                        payable: 50,
                        remainder: 0
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 950,
                    balanceChange: -50
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": "basic-order-vs"
                }
            ],
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.balance, 950);

        const getOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order-1", "GET");
        chai.assert.equal(getOrderResp.statusCode, 200, `body=${JSON.stringify(getOrderResp.body)}`);
        chai.assert.deepEqualExcluding(getOrderResp.body, postOrderResp.body, "statusCode");
    });

    it("process order with two ValueStores", async () => {
        console.log("wubawubawuba");
        const giftCard: Partial<Value> = {
            id: "vs-order2-giftcard",
            // valueStoreType: "GIFTCARD",
            currency: "CAD",
            balance: 1000
        };
        const promotion: Partial<Value> = {
            id: "vs-order2-promotion",
            // valueStoreType: "PROMOTION",
            currency: "CAD",
            balance: 10,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotionResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(createPromotionResp.statusCode, 201, `body=${JSON.stringify(createPromotionResp.body)}`);

        const request = {
            id: "order-2",
            sources: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                },
                {
                    rail: "lightrail",
                    valueId: promotion.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 50
                }
            ],
            currency: "CAD"
        };
        const postOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            id: request.id,
            transactionType: "order",
            currency: "CAD",
            totals: {
                subTotal: 50,
                tax: 0,
                discount: 10,
                payable: 40,
                remainder: 0
            },
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 50,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 50,
                        taxable: 50,
                        tax: 0,
                        discount: 10,
                        payable: 40,
                        remainder: 0
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: promotion.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 10,
                    balanceAfter: 0,
                    balanceChange: -10
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 960,
                    balanceChange: -40
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": "vs-order2-giftcard"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-order2-promotion"
                }
            ],
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getPromotionVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${promotion.id}`, "GET");
        chai.assert.equal(getPromotionVS.statusCode, 200, `body=${JSON.stringify(getPromotionVS.body)}`);
        chai.assert.equal(getPromotionVS.body.balance, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.balance, 960);

        const getOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order-2", "GET");
        chai.assert.equal(getOrderResp.statusCode, 200, `body=${JSON.stringify(getOrderResp.body)}`);
        chai.assert.deepEqualExcluding(getOrderResp.body, postOrderResp.body, "statusCode");
    });

    it("process order with 3 ValueStores with complicated tax implications", async () => {
        const giftCard: Partial<Value> = {
            id: "vs-order3-giftcard",
            // valueStoreType: "GIFTCARD",
            currency: "CAD",
            balance: 1010
        };
        const preTaxPromotion: Partial<Value> = {
            id: "vs-order3-promotion1",
            // valueStoreType: "PROMOTION",
            currency: "CAD",
            balance: 200,
            pretax: true,
            discount: true
        };
        const postTaxPromotion: Partial<Value> = {
            id: "vs-order3-promotion2",
            // valueStoreType: "PROMOTION",
            currency: "CAD",
            balance: 25,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotion1Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", preTaxPromotion);
        chai.assert.equal(createPromotion1Resp.statusCode, 201, `body=${JSON.stringify(createPromotion1Resp.body)}`);

        const createPromotion2Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", postTaxPromotion);
        chai.assert.equal(createPromotion2Resp.statusCode, 201, `body=${JSON.stringify(createPromotion2Resp.body)}`);

        const request = {
            id: "order-3",
            sources: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                },
                {
                    rail: "lightrail",
                    valueId: preTaxPromotion.id
                },
                {
                    rail: "lightrail",
                    valueId: postTaxPromotion.id
                }
            ],
            lineItems: [
                {
                    type: "shipping",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 333,
                    quantity: 2,
                    taxRate: 0.08
                }
            ],
            currency: "CAD"
        };
        const postOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            id: request.id,
            transactionType: "order",
            currency: "CAD",
            totals: {
                subTotal: 1166,
                tax: 68,
                discount: 225,
                payable: 1009,
                remainder: 0
            },
            lineItems: [
                {
                    type: "shipping",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.05,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 500,
                        taxable: 300,
                        tax: 15,
                        discount: 225,
                        payable: 290,
                        remainder: 0
                    }
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 333,
                    quantity: 2,
                    taxRate: 0.08,
                    lineTotal: {
                        subtotal: 666,
                        taxable: 666,
                        tax: 53 /* 53.28 */,
                        discount: 0,
                        payable: 719,
                        remainder: 0
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: preTaxPromotion.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 200,
                    balanceAfter: 0,
                    balanceChange: -200
                },
                {
                    rail: "lightrail",
                    valueId: postTaxPromotion.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 25,
                    balanceAfter: 0,
                    balanceChange: -25
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1010,
                    balanceAfter: 1,
                    balanceChange: -1009
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": "vs-order3-giftcard"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-order3-promotion1"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-order3-promotion2"
                }
            ],
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getPreTaxPromo = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${preTaxPromotion.id}`, "GET");
        chai.assert.equal(getPreTaxPromo.statusCode, 200, `body=${JSON.stringify(getPreTaxPromo.body)}`);
        chai.assert.equal(getPreTaxPromo.body.balance, 0);

        const getPostTaxPromo = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${postTaxPromotion.id}`, "GET");
        chai.assert.equal(getPostTaxPromo.statusCode, 200, `body=${JSON.stringify(getPostTaxPromo.body)}`);
        chai.assert.equal(getPostTaxPromo.body.balance, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.balance, 1);

        const getOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order-3", "GET");
        chai.assert.equal(getOrderResp.statusCode, 200, `body=${JSON.stringify(getOrderResp.body)}`);
        chai.assert.deepEqualExcluding(getOrderResp.body, postOrderResp.body, "statusCode");
    });


    it("process order with insufficientValue followed by allowRemainder = true", async () => {
        const giftCard: Partial<Value> = {
            id: "vs-order4-giftcard",
            currency: "CAD",
            balance: 500
        };
        const preTaxPromotion: Partial<Value> = {
            id: "vs-order4-promotion1",
            currency: "CAD",
            balance: 200,
            pretax: true,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotion1Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", preTaxPromotion);
        chai.assert.equal(createPromotion1Resp.statusCode, 201, `body=${JSON.stringify(createPromotion1Resp.body)}`);

        let request: any = {
            id: "order-4",
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
                    unitPrice: 500,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 333,
                    quantity: 2,
                    taxRate: 0.08
                }
            ],
            currency: "CAD"
        };
        const postOrderRespInsufficientValue = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderRespInsufficientValue.statusCode, 409, `body=${JSON.stringify(postOrderRespInsufficientValue.body)}`);
        chai.assert.equal(postOrderRespInsufficientValue.body.messageCode, "InsufficientValue", `body=${JSON.stringify(postOrderRespInsufficientValue.body)}`);

        request.allowRemainder = true;
        const postOrderResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            id: request.id,
            transactionType: "order",
            currency: "CAD",
            totals: {
                subTotal: 1166,
                tax: 68,
                discount: 200,
                payable: 1034,
                remainder: 534
            },
            lineItems: [
                {
                    type: "shipping",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.05,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 500,
                        taxable: 300,
                        tax: 15,
                        discount: 200,
                        payable: 315,
                        remainder: 0
                    }
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 333,
                    quantity: 2,
                    taxRate: 0.08,
                    lineTotal: {
                        subtotal: 666,
                        taxable: 666,
                        tax: 53 /* 53.28 */,
                        discount: 0,
                        payable: 719,
                        remainder: 534
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: preTaxPromotion.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 200,
                    balanceAfter: 0,
                    balanceChange: -200
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 500,
                    balanceAfter: 0,
                    balanceChange: -500
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": "vs-order4-giftcard"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-order4-promotion1"
                }
            ],
            metadata: null
        }, ["createdDate"]);

        const getPreTaxPromo = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${preTaxPromotion.id}`, "GET");
        chai.assert.equal(getPreTaxPromo.statusCode, 200, `body=${JSON.stringify(getPreTaxPromo.body)}`);
        chai.assert.equal(getPreTaxPromo.body.balance, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.balance, 0);

        const getOrderResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/order-4", "GET");
        chai.assert.equal(getOrderResp.statusCode, 200, `body=${JSON.stringify(getOrderResp.body)}`);
        chai.assert.deepEqualExcluding(getOrderResp.body, postOrderResp.body, "statusCode");
    });

    it("test valueRule", async () => {
        const promotion: Partial<Value> = {
            id: "test value rule",
            currency: "CAD",
            valueRule: {
                rule: "total*0.5",
                explanation: "testing it out!"
            },
            pretax: true,
            discount: true
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        const result: number = getRuleFromCache(promotion.valueRule.rule).evaluateToNumber({total: 50});
        chai.assert.equal(result, 25, `expected result to equal ${25}`);
    });

    it("basic value rule test", async () => {
        const promotion: Partial<Value> = {
            id: "test value rule 1",
            currency: "CAD",
            valueRule: {
                rule: "currentLineItem.lineTotal.subtotal*0.5",
                explanation: "50% off everything"
            },
            pretax: true,
            discount: true
        };

        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        let request: any = {
            id: "order-5-valueRuleTest",
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

        const postOrderResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            id: request.id,
            transactionType: "debit",
            totals: {
                subTotal: 1000,
                tax: 50,
                discount: 500,
                payable: 550,
                remainder: 550
            },
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.10,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 500,
                        taxable: 250,
                        tax: 25,
                        discount: 250,
                        payable: 275,
                        remainder: 275
                    }
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 250,
                    quantity: 2,
                    taxRate: 0.10,
                    lineTotal: {
                        subtotal: 500,
                        taxable: 250,
                        tax: 25,
                        discount: 250,
                        payable: 275,
                        remainder: 275
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: promotion.id,
                    // valueStoreType: preTaxPromotion.valueStoreType,
                    currency: promotion.currency,
                    code: null,
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 0,
                    balanceChange: 0
                }
            ]
        }, ["createdDate"]);
    });

    /*
    todo - Friday afternoon notes: think about how to limit a customer from doubling up on a promotion. Bryan may have some ideas.
    todo - How do we order the application of promotions?
    todo - How can we optimize the outcome for a user? Could try all combinations of ordering steps and see which one is the best.
     */
    it("basic value rule test 2", async () => {
        const promotion: Partial<Value> = {
            id: "test value rule324  1",
            currency: "CAD",
            valueRule: {
                rule: "currentLineItem.lineTotal.subtotal * 0.5",
                explanation: "50% off line item"
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

        let request: any = {
            id: "order-5-234 ",
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

        const postOrderResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/order", "POST", request);
        chai.assert.equal(postOrderResp.statusCode, 201, `body=${JSON.stringify(postOrderResp.body)}`);
        chai.assert.deepEqualExcluding(postOrderResp.body, {
            id: request.id,
            transactionType: "debit",
            totals: {
                subTotal: 1000,
                tax: 75,
                discount: 250,
                payable: 825,
                remainder: 825
            },
            lineItems: [
                {
                    type: "product",
                    productId: "p1",
                    unitPrice: 500,
                    taxRate: 0.10,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 500,
                        taxable: 250,
                        tax: 25,
                        discount: 250,
                        payable: 275,
                        remainder: 275
                    }
                },
                {
                    type: "product",
                    productId: "p2",
                    unitPrice: 250,
                    quantity: 2,
                    taxRate: 0.10,
                    lineTotal: {
                        subtotal: 500,
                        taxable: 500,
                        tax: 50,
                        discount: 0,
                        payable: 550,
                        remainder: 550
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: promotion.id,
                    // valueStoreType: preTaxPromotion.valueStoreType,
                    currency: promotion.currency,
                    code: null,
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 0,
                    balanceChange: 0
                }
            ]
        }, ["createdDate"]);
    });
});

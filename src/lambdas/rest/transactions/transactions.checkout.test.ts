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

describe("/v2/transactions/checkout", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        currencies.installCurrenciesRest(router);
    });

    it("processes basic checkout", async () => {
        const currency: Currency = {
            code: "CAD",
            name: "Monopoly Money",
            symbol: "$",
            decimalPlaces: 2
        };
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const giftCard: Partial<Value> = {
            id: "basic-checkout-vs",
            // type: "GIFTCARD",
            currency: "CAD",
            balance: 1000
        };

        const postValueStoreResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const request = {
            id: "checkout-1",
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
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            id: "checkout-1",
            transactionType: "checkout",
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
                    "valueId": "basic-checkout-vs"
                }
            ],
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.balance, 950);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-1", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, "statusCode");
    });

    it("process checkout with two ValueStores", async () => {
        console.log("wubawubawuba");
        const giftCard: Partial<Value> = {
            id: "vs-checkout2-giftcard",
            // valueStoreType: "GIFTCARD",
            currency: "CAD",
            balance: 1000
        };
        const promotion: Partial<Value> = {
            id: "vs-checkout2-promotion",
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
            id: "checkout-2",
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
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            id: request.id,
            transactionType: "checkout",
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
                    "valueId": "vs-checkout2-giftcard"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout2-promotion"
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

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-2", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, "statusCode");
    });

    it("process checkout with 3 ValueStores with complicated tax implications", async () => {
        const giftCard: Partial<Value> = {
            id: "vs-checkout3-giftcard",
            // valueStoreType: "GIFTCARD",
            currency: "CAD",
            balance: 1010
        };
        const preTaxPromotion: Partial<Value> = {
            id: "vs-checkout3-promotion1",
            // valueStoreType: "PROMOTION",
            currency: "CAD",
            balance: 200,
            pretax: true,
            discount: true
        };
        const postTaxPromotion: Partial<Value> = {
            id: "vs-checkout3-promotion2",
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
            id: "checkout-3",
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
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            id: request.id,
            transactionType: "checkout",
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
                    "valueId": "vs-checkout3-giftcard"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout3-promotion1"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout3-promotion2"
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

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-3", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, "statusCode");
    });


    it("process checkout with insufficientValue followed by allowRemainder = true", async () => {
        const giftCard: Partial<Value> = {
            id: "vs-checkout4-giftcard",
            currency: "CAD",
            balance: 500
        };
        const preTaxPromotion: Partial<Value> = {
            id: "vs-checkout4-promotion1",
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
            id: "checkout-4",
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
        const postCheckoutRespInsufficientValue = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutRespInsufficientValue.statusCode, 409, `body=${JSON.stringify(postCheckoutRespInsufficientValue.body)}`);
        chai.assert.equal(postCheckoutRespInsufficientValue.body.messageCode, "InsufficientValue", `body=${JSON.stringify(postCheckoutRespInsufficientValue.body)}`);

        request.allowRemainder = true;
        const postCheckoutResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            id: request.id,
            transactionType: "checkout",
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
                    "valueId": "vs-checkout4-giftcard"
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout4-promotion1"
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

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-4", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, "statusCode");
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
            id: "checkout-5-valueRuleTest",
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

        const postCheckoutResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", request);
        console.log(JSON.stringify(postCheckoutResp));
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": "checkout-5-valueRuleTest",
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subTotal": 1000,
                "tax": 50,
                "discount": 500,
                "payable": 550,
                "remainder": 550
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
            "steps": [],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": "test value rule 1"
                }
            ],
            "metadata": null
        }, ["createdDate"]);
    });

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
            id: "checkout-5-234 ",
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

        const postCheckoutResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", request);
        console.log(JSON.stringify(postCheckoutResp));
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": "checkout-5-234 ",
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subTotal": 1000,
                "tax": 75,
                "discount": 250,
                "payable": 825,
                "remainder": 825
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
                        "taxable": 500,
                        "tax": 50,
                        "discount": 0,
                        "remainder": 550,
                        "payable": 550
                    }
                }
            ],
            "steps": [],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": "test value rule324  1"
                }
            ],
            "metadata": null
        }, ["createdDate"]);
    });
});

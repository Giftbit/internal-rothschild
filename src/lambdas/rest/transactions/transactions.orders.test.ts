import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";
import {Transaction} from "../../../model/Transaction";

describe("/v2/transactions/order", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    it("basic order", async () => {
        const giftCard: Partial<ValueStore> = {
            valueStoreId: "basic-order-vs",
            valueStoreType: "GIFTCARD",
            currency: "CAD",
            value: 1000
        };

        const postValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", giftCard);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const request = {
            transactionId: "order-1",
            sources: [
                {
                    rail: "lightrail",
                    valueStoreId: giftCard.valueStoreId
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
            transactionId: "order-1",
            transactionType: "debit",
            remainder: 0,
            totals: {
                subTotal: 50,
                tax: 0,
                discount: 0,
                payable: 50
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
                    valueStoreId: giftCard.valueStoreId,
                    valueStoreType: giftCard.valueStoreType,
                    currency: giftCard.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 1000,
                    valueAfter: 950,
                    valueChange: -50
                }
            ]
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${giftCard.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 950);
    });

    it("order with two ValueStores", async () => {
        const giftCard: Partial<ValueStore> = {
            valueStoreId: "vs-order2-giftcard",
            valueStoreType: "GIFTCARD",
            currency: "CAD",
            value: 1000
        };
        const promotion: Partial<ValueStore> = {
            valueStoreId: "vs-order2-promotion",
            valueStoreType: "PROMOTION",
            currency: "CAD",
            value: 10,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotionResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", promotion);
        chai.assert.equal(createPromotionResp.statusCode, 201, `body=${JSON.stringify(createPromotionResp.body)}`);

        const request = {
            transactionId: "order-2",
            sources: [
                {
                    rail: "lightrail",
                    valueStoreId: giftCard.valueStoreId
                },
                {
                    rail: "lightrail",
                    valueStoreId: promotion.valueStoreId
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
            transactionId: request.transactionId,
            transactionType: "debit",
            remainder: 0,
            totals: {
                subTotal: 50,
                tax: 0,
                discount: 10,
                payable: 40
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
                    valueStoreId: promotion.valueStoreId,
                    valueStoreType: promotion.valueStoreType,
                    currency: promotion.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 10,
                    valueAfter: 0,
                    valueChange: -10
                },
                {
                    rail: "lightrail",
                    valueStoreId: giftCard.valueStoreId,
                    valueStoreType: giftCard.valueStoreType,
                    currency: giftCard.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 1000,
                    valueAfter: 960,
                    valueChange: -40
                }
            ]
        }, ["createdDate"]);

        const getPromotionVS = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${promotion.valueStoreId}`, "GET");
        chai.assert.equal(getPromotionVS.statusCode, 200, `body=${JSON.stringify(getPromotionVS.body)}`);
        chai.assert.equal(getPromotionVS.body.value, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${giftCard.valueStoreId}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.value, 960);
    });

    it("order with 3 ValueStores with complicated tax implications", async () => {
        const giftCard: Partial<ValueStore> = {
            valueStoreId: "vs-order3-giftcard",
            valueStoreType: "GIFTCARD",
            currency: "CAD",
            value: 1010
        };
        const preTaxPromotion: Partial<ValueStore> = {
            valueStoreId: "vs-order3-promotion1",
            valueStoreType: "PROMOTION",
            currency: "CAD",
            value: 200,
            pretax: true,
            discount: true
        };
        const postTaxPromotion: Partial<ValueStore> = {
            valueStoreId: "vs-order3-promotion2",
            valueStoreType: "PROMOTION",
            currency: "CAD",
            value: 25,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotion1Resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", preTaxPromotion);
        chai.assert.equal(createPromotion1Resp.statusCode, 201, `body=${JSON.stringify(createPromotion1Resp.body)}`);

        const createPromotion2Resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", postTaxPromotion);
        chai.assert.equal(createPromotion2Resp.statusCode, 201, `body=${JSON.stringify(createPromotion2Resp.body)}`);

        const request = {
            transactionId: "order-3",
            sources: [
                {
                    rail: "lightrail",
                    valueStoreId: giftCard.valueStoreId
                },
                {
                    rail: "lightrail",
                    valueStoreId: preTaxPromotion.valueStoreId
                },
                {
                    rail: "lightrail",
                    valueStoreId: postTaxPromotion.valueStoreId
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
            transactionId: request.transactionId,
            transactionType: "debit",
            remainder: 0,
            totals: {
                subTotal: 1166,
                tax: 68,
                discount: 225,
                payable: 1009
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
                    valueStoreId: preTaxPromotion.valueStoreId,
                    valueStoreType: preTaxPromotion.valueStoreType,
                    currency: preTaxPromotion.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 200,
                    valueAfter: 0,
                    valueChange: -200
                },
                {
                    rail: "lightrail",
                    valueStoreId: postTaxPromotion.valueStoreId,
                    valueStoreType: postTaxPromotion.valueStoreType,
                    currency: postTaxPromotion.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 25,
                    valueAfter: 0,
                    valueChange: -25
                },
                {
                    rail: "lightrail",
                    valueStoreId: giftCard.valueStoreId,
                    valueStoreType: giftCard.valueStoreType,
                    currency: giftCard.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 1010,
                    valueAfter: 1,
                    valueChange: -1009
                }
            ]
        }, ["createdDate"]);

        const getPreTaxPromo = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${preTaxPromotion.valueStoreId}`, "GET");
        chai.assert.equal(getPreTaxPromo.statusCode, 200, `body=${JSON.stringify(getPreTaxPromo.body)}`);
        chai.assert.equal(getPreTaxPromo.body.value, 0);

        const getPostTaxPromo = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${postTaxPromotion.valueStoreId}`, "GET");
        chai.assert.equal(getPostTaxPromo.statusCode, 200, `body=${JSON.stringify(getPostTaxPromo.body)}`);
        chai.assert.equal(getPostTaxPromo.body.value, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${giftCard.valueStoreId}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.value, 1);
    });
});

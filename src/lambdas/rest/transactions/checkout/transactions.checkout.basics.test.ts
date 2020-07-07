import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils";
import {Value} from "../../../../model/Value";
import {LightrailTransactionStep, Transaction} from "../../../../model/Transaction";
import {formatCodeForLastFourDisplay, Value} from "../../../../model/Value";
import {Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import {getKnexRead} from "../../../../utils/dbUtils/connection";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {Contact} from "../../../../model/Contact";
import {installRestRoutes} from "../../installRestRoutes";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../../utils/dbUtils";
import {LightrailTransactionStep} from "../../../../model/TransactionStep";

chai.use(chaiExclude);

describe("/v2/transactions/checkout - basics", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();
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

    it("processes basic order", async () => {
        const giftCard: Partial<Value> = {
            id: "basic-checkout-vs",
            currency: "CAD",
            balance: 1000
        };

        const postValueStoreResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const request: CheckoutRequest = {
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
                    productId: "happiness-😃",
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
                subtotal: 50,
                tax: 0,
                discount: 0,
                discountLightrail: 0,
                payable: 50,
                paidInternal: 0,
                paidLightrail: 50,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
            },
            lineItems: [
                {
                    type: "product",
                    productId: "happiness-😃",   // turns out you can buy it after all
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
                    balanceChange: -50,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            paymentSources: [
                {
                    rail: "lightrail",
                    valueId: "basic-checkout-vs"
                }
            ],
            pending: false,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.balance, 950);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-1", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);

        // check DbTransaction created by checkout
        const knex = await getKnexRead();
        const res = await knex("Transactions")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: request.id
            });
        chai.assert.deepEqualExcluding(
            res[0], {
                "userId": "default-test-user-TEST",
                "id": "checkout-1",
                "transactionType": "checkout",
                "currency": "CAD",
                "lineItems": "[{\"type\":\"product\",\"productId\":\"happiness-😃\",\"unitPrice\":50,\"quantity\":1,\"lineTotal\":{\"subtotal\":50,\"taxable\":50,\"tax\":0,\"discount\":0,\"remainder\":0,\"payable\":50}}]",
                "paymentSources": "[{\"rail\":\"lightrail\",\"valueId\":\"basic-checkout-vs\"}]",
                "pendingVoidDate": null,
                "metadata": null,
                "tax": "{\"roundingMode\":\"HALF_EVEN\"}",
                "createdBy": "default-test-user-TEST",
                "totals_subtotal": 50,
                "totals_tax": 0,
                "totals_discountLightrail": 0,
                "totals_paidLightrail": 50,
                "totals_paidStripe": 0,
                "totals_paidInternal": 0,
                "totals_remainder": 0,
                "totals_forgiven": 0,
                "nextTransactionId": null,
                "rootTransactionId": "checkout-1",
                "totals_marketplace_sellerGross": null,
                "totals_marketplace_sellerDiscount": null,
                "totals_marketplace_sellerNet": null
            }, ["createdDate", "totals"]
        );
    });

    it("process checkout with two ValueStores", async () => {
        const giftCard: Partial<Value> = {
            id: "vs-checkout2-giftcard",
            currency: "CAD",
            balance: 1000
        };
        const promotion: Partial<Value> = {
            id: "vs-checkout2-promotion",
            currency: "CAD",
            balance: 10,
            discount: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotionResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(createPromotionResp.statusCode, 201, `body=${JSON.stringify(createPromotionResp.body)}`);

        const request: CheckoutRequest = {
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
                subtotal: 50,
                tax: 0,
                discount: 10,
                discountLightrail: 10,
                payable: 40,
                paidInternal: 0,
                paidLightrail: 40,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
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
                    balanceChange: -10,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 960,
                    balanceChange: -40,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
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
            pending: false,
            metadata: null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getPromotionVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${promotion.id}`, "GET");
        chai.assert.equal(getPromotionVS.statusCode, 200, `body=${JSON.stringify(getPromotionVS.body)}`);
        chai.assert.equal(getPromotionVS.body.balance, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.balance, 960);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-2", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);
    });

    it("process checkout with 3 ValueStores with complicated tax implications", async () => {
        const giftCard: Partial<Value> = {
            id: "vs-checkout3-giftcard",
            currency: "CAD",
            balance: 1010
        };
        const preTaxPromotion: Partial<Value> = {
            id: "vs-checkout3-promotion1",
            currency: "CAD",
            balance: 200,
            pretax: true,
            discount: true
        };
        const postTaxPromotion: Partial<Value> = {
            id: "vs-checkout3-promotion2",
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

        const request: CheckoutRequest = {
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
            "id": "checkout-3",
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 1166,
                "tax": 62,
                "discount": 225,
                discountLightrail: 225,
                "payable": 1003,
                paidInternal: 0,
                paidLightrail: 1003,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "p2",
                    "unitPrice": 333,
                    "quantity": 2,
                    "taxRate": 0.08,
                    "lineTotal": {
                        "subtotal": 666,
                        "taxable": 466,
                        "tax": 37,
                        "discount": 225,
                        "remainder": 0,
                        "payable": 478
                    }
                },
                {
                    "type": "shipping",
                    "productId": "p1",
                    "unitPrice": 500,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 500,
                        "taxable": 500,
                        "tax": 25,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 525
                    }
                }
            ],
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout3-promotion1",
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 200,
                    "balanceAfter": 0,
                    "balanceChange": -200,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout3-promotion2",
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 25,
                    "balanceAfter": 0,
                    "balanceChange": -25,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                },
                {
                    "rail": "lightrail",
                    "valueId": "vs-checkout3-giftcard",
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 1010,
                    "balanceAfter": 7,
                    "balanceChange": -1003,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
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
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getPreTaxPromo = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${preTaxPromotion.id}`, "GET");
        chai.assert.equal(getPreTaxPromo.statusCode, 200, `body=${JSON.stringify(getPreTaxPromo.body)}`);
        chai.assert.equal(getPreTaxPromo.body.balance, 0);

        const getPostTaxPromo = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${postTaxPromotion.id}`, "GET");
        chai.assert.equal(getPostTaxPromo.statusCode, 200, `body=${JSON.stringify(getPostTaxPromo.body)}`);
        chai.assert.equal(getPostTaxPromo.body.balance, 0);

        const getGiftCardVS = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getGiftCardVS.statusCode, 200, `body=${JSON.stringify(getGiftCardVS.body)}`);
        chai.assert.equal(getGiftCardVS.body.balance, 7);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout-3", "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);
    });

    it("checkout with duplicated values", async () => {
        const giftCard: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000
        };

        const postValueStoreResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const request: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                },
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
            id: request.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                subtotal: 50,
                tax: 0,
                discount: 0,
                discountLightrail: 0,
                payable: 50,
                paidInternal: 0,
                paidLightrail: 50,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
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
                    balanceChange: -50,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            paymentSources: [
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                }
            ],
            pending: false,
            metadata: null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${giftCard.id}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.balance, 950);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);
    });

    it("cannot create checkout with id over max length - 422s", async () => {
        const request: CheckoutRequest = {
            id: generateId(65),
            sources: [
                {
                    rail: "internal",
                    balance: 1,
                    internalId: generateId(65)

                }
            ],
            lineItems: [
                {
                    unitPrice: 50
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 422, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.include(postCheckoutResp.body.message, "requestBody.id does not meet maximum length of 64");
    });

    describe("checkout generic value", () => {
        let contact: Contact;
        let genericValue: Value;
        let accountCredit: Value;
        let attachedValue: Value;

        before(async () => {
            const contactRequest: Partial<Contact> = {
                id: generateId(),
                firstName: "Hayley"
            };
            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactRequest);
            chai.assert.equal(createContact.statusCode, 201);
            contact = createContact.body;

            const genericValueRequest: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                isGenericCode: true,
                balanceRule: {
                    rule: "currentLineItem.lineTotal.subtotal * 0.50",
                    explanation: "50% off each item"
                },
                discount: true,
                pretax: true,
                usesRemaining: 100,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                },
                code: "WINTERISCOMING19"
            };
            const createGenericValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValueRequest);
            chai.assert.equal(createGenericValue.statusCode, 201);
            genericValue = createGenericValue.body;

            const accountCreditRequest: Partial<Value> = {
                id: generateId(),
                balance: 80,
                currency: "CAD",
                contactId: contact.id
            };
            const createAccountCredit = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", accountCreditRequest);
            chai.assert.equal(createAccountCredit.statusCode, 201);
            accountCredit = createAccountCredit.body;

            const attachValue = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attachValue.statusCode, 200);
            attachedValue = attachValue.body;
        });

        it("can checkout with a attached generic value", async () => {
            const checkout: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "lightrail",
                        contactId: contact.id
                    }
                ],
                lineItems: [
                    {
                        unitPrice: 150,
                        taxRate: 0.05
                    }
                ],
                currency: "CAD"
            };
            const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
            chai.assert.equal(createCheckout.statusCode, 201);
            chai.assert.deepEqualExcluding(createCheckout.body,
                {
                    "id": checkout.id,
                    "transactionType": "checkout",
                    "currency": "CAD",
                    "createdDate": null,
                    "tax": {
                        "roundingMode": "HALF_EVEN"
                    },
                    "totals": {
                        "subtotal": 150,
                        "tax": 4,
                        "discount": 75,
                        "payable": 79,
                        "remainder": 0,
                        "forgiven": 0,
                        "discountLightrail": 75,
                        "paidLightrail": 79,
                        "paidStripe": 0,
                        "paidInternal": 0
                    },
                    "lineItems": [
                        {
                            "unitPrice": 150,
                            "quantity": 1,
                            "taxRate": 0.05,
                            "lineTotal": {
                                "subtotal": 150,
                                "taxable": 75,
                                "tax": 4,
                                "discount": 75,
                                "remainder": 0,
                                "payable": 79
                            }
                        }
                    ],
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": attachedValue.id,
                            "contactId": contact.id,
                            "code": null,
                            "balanceBefore": null,
                            "balanceAfter": null,
                            "balanceChange": -75,
                            "usesRemainingBefore": 1,
                            "usesRemainingAfter": 0,
                            "usesRemainingChange": -1
                        },
                        {
                            "rail": "lightrail",
                            "valueId": accountCredit.id,
                            "contactId": contact.id,
                            "code": null,
                            "balanceBefore": 80,
                            "balanceAfter": 1,
                            "balanceChange": -79,
                            "usesRemainingBefore": null,
                            "usesRemainingAfter": null,
                            "usesRemainingChange": null
                        }
                    ],
                    "paymentSources": [
                        {
                            "rail": "lightrail",
                            "contactId": contact.id
                        }
                    ],
                    "pending": false,
                    "metadata": null,
                    "createdBy": "default-test-user-TEST"
                }, ["createdDate"]);
            chai.assert.equal((createCheckout.body.steps[0] as LightrailTransactionStep).contactId, contact.id, "The contactId is not directly on the Value, but attached to the Value via ContactValues. It's important for tracking reasons that the contactId is persisted onto the transaction step.");

            const listTransactionsAssociatedWithContact = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?contactId=${contact.id}`, "GET");
            chai.assert.equal(listTransactionsAssociatedWithContact.body.length, 3, "Should return 2 transactions. initialBalance, attach, and checkout");
            chai.assert.sameMembers(listTransactionsAssociatedWithContact.body.map(t => t.transactionType), ["initialBalance", "attach", "checkout"]);
            chai.assert.deepEqual(listTransactionsAssociatedWithContact.body.find(tx => tx.transactionType === "checkout"), createCheckout.body);
        });

        it("can't checkout directly against generic code", async () => {
            const checkout: CheckoutRequest = {
                id: generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "lightrail",
                        code: genericValue.code
                    }
                ],
                lineItems: [
                    {
                        unitPrice: 150,
                        taxRate: 0.05
                    }
                ],
                currency: "CAD"
            };
            const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
            chai.assert.equal(createCheckout.statusCode, 409);
        });

        it("can't checkout with a generic code that will be auto-attached with a contactId that doesn't exist", async () => {
            const checkout: CheckoutRequest = {
                id: generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "lightrail",
                        code: genericValue.code
                    },
                    {
                        rail: "lightrail",
                        contactId: "not an actual contact id"
                    }
                ],
                lineItems: [
                    {
                        unitPrice: 150,
                        taxRate: 0.05
                    }
                ],
                currency: "CAD"
            };
            const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
            chai.assert.equal(createCheckout.statusCode, 404);
        });
    });

});

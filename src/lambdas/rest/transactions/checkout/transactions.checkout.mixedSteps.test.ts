import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values/values";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import {formatCodeForLastFourDisplay, Value} from "../../../../model/Value";
import {after} from "mocha";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../../utils/testUtils/stripeTestUtils";
import {CheckoutRequest, InternalTransactionParty} from "../../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";

chai.use(chaiExclude);

describe("/v2/transactions/checkout - mixed sources", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);

        await setStubsForStripeTests();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Tire Money",
            symbol: "$",
            decimalPlaces: 2
        });
        await setCodeCryptographySecrets();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("checkout with mixed sources", async () => {
        const giftCard: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 60
        };
        const promotion: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 10,
            discount: true,
            pretax: true
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotionResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(createPromotionResp.statusCode, 201, `body=${JSON.stringify(createPromotionResp.body)}`);

        const request: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "stripe",
                    source: "tok_visa"
                },
                {
                    rail: "internal",
                    balance: 200,
                    internalId: generateId(),
                },
                {
                    rail: "internal",
                    balance: 500,
                    internalId: generateId(),
                    beforeLightrail: true
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                },
                {
                    rail: "internal",
                    balance: 50,
                    internalId: generateId(),
                    pretax: true,
                    beforeLightrail: true
                },
                {
                    rail: "lightrail",
                    valueId: promotion.id
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "guacamole",
                    unitPrice: 422,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "cream-18%",
                    unitPrice: 399,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "chips-and-dips-deluxe",
                    unitPrice: 629,
                    taxRate: 0.05,
                    quantity: 2
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 2079,
                "tax": 101,
                "discount": 10,
                "discountLightrail": 10,
                "payable": 2170,
                "paidInternal": 750,
                "paidLightrail": 60,
                "paidStripe": 1360,
                "remainder": 0,
                "forgiven": 0,
                "unaccounted": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "chips-and-dips-deluxe",
                    "unitPrice": 629,
                    "taxRate": 0.05,
                    "quantity": 2,
                    "lineTotal": {
                        "subtotal": 1258,
                        "taxable": 1198,
                        "tax": 60,
                        "discount": 10,
                        "remainder": 0,
                        "payable": 1308
                    }
                },
                {
                    "type": "product",
                    "productId": "guacamole",
                    "unitPrice": 422,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 422,
                        "taxable": 422,
                        "tax": 21,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 443
                    }
                },
                {
                    "type": "product",
                    "productId": "cream-18%",
                    "unitPrice": 399,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 399,
                        "taxable": 399,
                        "tax": 20,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 419
                    }
                }
            ],
            "steps": null,
            "paymentSources": null,
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate", "steps", "paymentSources", "createdBy"]);

        chai.assert.deepEqual(postCheckoutResp.body.steps[0], {
            "rail": "internal",
            "internalId": (request.sources[4] as InternalTransactionParty).internalId,
            "balanceBefore": 50,
            "balanceAfter": 0,
            "balanceChange": -50
        });
        chai.assert.deepEqual(postCheckoutResp.body.steps[1], {
            "rail": "lightrail",
            "valueId": promotion.id,
            "contactId": null,
            "code": null,
            "balanceBefore": 10,
            "balanceAfter": 0,
            "balanceChange": -10,
            "usesRemainingBefore": null,
            "usesRemainingAfter": null,
            "usesRemainingChange": null
        });
        chai.assert.deepEqual(postCheckoutResp.body.steps[2], {
            "rail": "internal",
            "internalId": (request.sources[2] as InternalTransactionParty).internalId,
            "balanceBefore": 500,
            "balanceAfter": 0,
            "balanceChange": -500
        });
        chai.assert.deepEqual(postCheckoutResp.body.steps[3], {
            "rail": "lightrail",
            "valueId": giftCard.id,
            "contactId": null,
            "code": null,
            "balanceBefore": 60,
            "balanceAfter": 0,
            "balanceChange": -60,
            "usesRemainingBefore": null,
            "usesRemainingAfter": null,
            "usesRemainingChange": null
        });
        chai.assert.deepEqual(postCheckoutResp.body.steps[4], {
            "rail": "internal",
            "internalId": (request.sources[1] as InternalTransactionParty).internalId,
            "balanceBefore": 200,
            "balanceAfter": 0,
            "balanceChange": -200
        });
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps[5] as StripeTransactionStep, {
            "rail": "stripe",
            "amount": -1360,
            "chargeId": null,
            "charge": null
        }, ["charge", "chargeId"]);

        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            "rail": "stripe",
            "source": "tok_visa",
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[1], {
            "rail": "internal",
            "balance": 200,
            "internalId": (request.sources[1] as InternalTransactionParty).internalId
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[2], {
            "rail": "internal",
            "balance": 500,
            "internalId": (request.sources[2] as InternalTransactionParty).internalId,
            "beforeLightrail": true
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[3], {
            "rail": "lightrail",
            "valueId": giftCard.id
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[4], {
            "rail": "internal",
            "balance": 50,
            "internalId": (request.sources[4] as InternalTransactionParty).internalId,
            "pretax": true,
            "beforeLightrail": true
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[5], {
            "rail": "lightrail",
            "valueId": promotion.id
        });
    }).timeout(5000);

    it("charges both generic and secret codes", async () => {
        const valueSecretCode = {
            id: generateId(),
            code: `${generateId()}-SECRET`,
            currency: "CAD",
            balance: 100
        };
        const valueGenericCode = {
            id: generateId(),
            code: `${generateId()}-GENERIC`,
            isGenericCode: true,
            currency: "CAD",
            balance: 2000
        };

        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueSecretCode);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueGenericCode);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const request = {
            id: generateId(),
            currency: "CAD",
            sources: [
                {
                    rail: "lightrail",
                    code: valueSecretCode.code
                },
                {
                    rail: "lightrail",
                    code: valueGenericCode.code
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "chips-and-dips-deluxe",
                    unitPrice: 2000,
                    taxRate: 0.05
                }
            ]
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 2000,
                "tax": 100,
                "discount": 0,
                "discountLightrail": 0,
                "payable": 2100,
                "paidInternal": 0,
                "paidLightrail": 2100,
                "paidStripe": 0,
                "remainder": 0,
                "forgiven": 0,
                "unaccounted": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "chips-and-dips-deluxe",
                    "quantity": 1,
                    "unitPrice": 2000,
                    "taxRate": 0.05,
                    "lineTotal": {
                        "subtotal": 2000,
                        "taxable": 2000,
                        "tax": 100,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 2100
                    }
                }
            ],
            "steps": null,
            "paymentSources": [
                {
                    rail: "lightrail",
                    code: "…CRET"
                },
                {
                    rail: "lightrail",
                    code: formatCodeForLastFourDisplay(valueGenericCode.code)
                }
            ],
            pending: false,
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate", "steps", "createdBy"]);

        const step1 = postCheckoutResp.body.steps.find(step => (step as LightrailTransactionStep).valueId === valueSecretCode.id);
        chai.assert.deepEqual(step1, {
            rail: "lightrail",
            valueId: valueSecretCode.id,
            contactId: null,
            code: "…CRET",
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null

        });
        const step2 = postCheckoutResp.body.steps.find(step => (step as LightrailTransactionStep).valueId === valueGenericCode.id);
        chai.assert.deepEqual(step2, {
                rail: "lightrail",
                valueId: valueGenericCode.id,
                contactId: null,
                code: formatCodeForLastFourDisplay(valueGenericCode.code),
                balanceBefore: 2000,
                balanceAfter: 0,
                balanceChange: -2000,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
            }
        );
    });

    it("can checkout with all source types and max id length", async () => {
        const giftCard: Partial<Value> = {
            id: generateId(64),
            currency: "CAD",
            balance: 1
        };
        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const request: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "stripe",
                    source: "tok_visa"
                },
                {
                    rail: "internal",
                    balance: 1,
                    internalId: generateId(64),
                },
                {
                    rail: "lightrail",
                    valueId: giftCard.id
                }
            ],
            lineItems: [
                {
                    unitPrice: 52,
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
    }).timeout(5000);
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils";
import {LightrailTransactionStep, Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {after} from "mocha";
import * as stripeTransactions from "../../../../utils/stripeUtils/stripeTransactions";
import * as sinon from "sinon";
import {
    setStubsForStripeTests,
    stripeEnvVarsPresent,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import chaiExclude = require("chai-exclude");
import Stripe = require("stripe");
import ICharge = Stripe.charges.ICharge;

chai.use(chaiExclude);

require("dotenv").config();

describe("/v2/transactions/checkout - mixed sources", () => {

    const router = new cassava.Router();

    before(async function () {
        if (!stripeEnvVarsPresent() && testStripeLive()) {
            this.skip();
            return;
        }

        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        if (!stripeEnvVarsPresent()) {
            this.skip();
            return;
        }
        setStubsForStripeTests();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Tire Money",
            symbol: "$",
            decimalPlaces: 2
        });
        await setCodeCryptographySecrets();
    });

    after(async function () {
        unsetStubsForStripeTests();
    });

    const sinonSandbox = sinon.createSandbox();

    afterEach(() => {
        sinonSandbox.restore();
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
        const exampleStripeResponse: ICharge = {
            "id": "ch_1CtmHMG3cz9DRdBtxz0Kq1Ha",
            "object": "charge",
            "amount": 1360,
            "amount_refunded": 0,
            "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
            "application_fee": null,
            "balance_transaction": "txn_1CtmHNG3cz9DRdBtMqj8DCmW",
            "captured": true,
            "created": 1532999040,
            "currency": "cad",
            "customer": null,
            "description": null,
            "destination": null,
            "dispute": null,
            "failure_code": null,
            "failure_message": null,
            "fraud_details": {},
            "invoice": null,
            "livemode": false,
            "metadata": {
                "lightrailTransactionId": "eb4e9aee-45e9-46fc-b",
                "lightrailTransactionSources": "[{\"rail\":\"internal\",\"internalId\":\"4c85b107-f7d9-4906-8\"},{\"rail\":\"lightrail\",\"valueId\":\"67de17b8-1e6b-43ee-b\"},{\"rail\":\"internal\",\"internalId\":\"f91e093f-35ce-4e77-b\"},{\"rail\":\"lightrail\",\"valueId\":\"2c07edb4-4958-47c0-b\"},{\"rail\":\"internal\",\"internalId\":\"16b4023b-283a-401c-b\"}]",
                "lightrailUserId": "default-test-user-TEST"
            },
            "on_behalf_of": null,
            "order": null,
            "outcome": {
                "network_status": "approved_by_network",
                "reason": null,
                "risk_level": "normal",
                "seller_message": "Payment complete.",
                "type": "authorized"
            },
            "paid": true,
            "receipt_email": null,
            "receipt_number": null,
            "refunded": false,
            "refunds": {
                "object": "list",
                "data": [],
                "has_more": false,
                "total_count": 0,
                "url": "/v1/charges/ch_1CtmHMG3cz9DRdBtxz0Kq1Ha/refunds"
            },
            "review": null,
            "shipping": null,
            "source": {
                "id": "card_1CtmHMG3cz9DRdBtmhOqLZGF",
                "object": "card",
                "address_city": null,
                "address_country": null,
                "address_line1": null,
                "address_line1_check": null,
                "address_line2": null,
                "address_state": null,
                "address_zip": null,
                "address_zip_check": null,
                "brand": "Visa",
                "country": "US",
                "customer": null,
                "cvc_check": null,
                "dynamic_last4": null,
                "exp_month": 7,
                "exp_year": 2019,
                "fingerprint": "LMHNXKv7kEbxUNL9",
                "funding": "credit",
                "last4": "4242",
                "metadata": {},
                "name": null,
                "tokenization_method": null
            },
            "source_transfer": null,
            "statement_descriptor": null,
            "status": "succeeded",
            "transfer_group": null
        };

        const createGiftCardResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCardResp.statusCode, 201, `body=${JSON.stringify(createGiftCardResp.body)}`);

        const createPromotionResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", promotion);
        chai.assert.equal(createPromotionResp.statusCode, 201, `body=${JSON.stringify(createPromotionResp.body)}`);

        const request = {
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

        if (!testStripeLive()) {
            sinonSandbox.stub(stripeTransactions, "createStripeCharge")
                .withArgs(sinon.match({
                    "amount": 1360,
                    "currency": request.currency,
                    "metadata": {
                        "lightrailTransactionId": request.id,
                        "lightrailTransactionSources": sinon.match("{\"rail\":\"internal\"")
                            .and(sinon.match("\"rail\":\"lightrail\""))
                            .and(sinon.match(`\"internalId\":\"${request.sources[1].internalId}\"`))
                            .and(sinon.match(`\"internalId\":\"${request.sources[2].internalId}\"`))
                            .and(sinon.match(`\"valueId\":\"${request.sources[3].valueId}\"`))
                            .and(sinon.match(`\"internalId\":\"${request.sources[4].internalId}\"`))
                            .and(sinon.match(`\"valueId\":\"${request.sources[5].valueId}\"`)),
                        "lightrailUserId": defaultTestUser.userId
                    },
                    "source": "tok_visa"
                }), sinon.match("test"), sinon.match("test"), sinon.match(`${request.id}-0`))
                .resolves(exampleStripeResponse);
        }

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
                "remainder": 0
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
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate", "steps", "paymentSources", "createdBy"]);

        chai.assert.deepEqual(postCheckoutResp.body.steps[0], {
            "rail": "internal",
            "internalId": request.sources[4].internalId,
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
            "internalId": request.sources[2].internalId,
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
            "internalId": request.sources[1].internalId,
            "balanceBefore": 200,
            "balanceAfter": 0,
            "balanceChange": -200
        });
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps[5], {
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
            "internalId": request.sources[1].internalId
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[2], {
            "rail": "internal",
            "balance": 500,
            "internalId": request.sources[2].internalId,
            "beforeLightrail": true
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[3], {
            "rail": "lightrail",
            "valueId": giftCard.id
        });
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[4], {
            "rail": "internal",
            "balance": 50,
            "internalId": request.sources[4].internalId,
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
                "remainder": 0
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
                    code: valueGenericCode.code
                }
            ],
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
                code: valueGenericCode.code,
                balanceBefore: 2000,
                balanceAfter: 0,
                balanceChange: -2000,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
            }
        );

    });
});

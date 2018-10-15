import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils/index";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import * as sinon from "sinon";
import {Value} from "../../../../model/Value";
import {
    InternalTransactionStep,
    LightrailTransactionStep,
    StripeTransactionStep,
    Transaction
} from "../../../../model/Transaction";
import {CheckoutRequest, DebitRequest, ReverseRequest} from "../../../../model/TransactionRequest";
import {after} from "mocha";
import {
    setStubsForStripeTests,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import * as stripeTransactions from "../../../../utils/stripeUtils/stripeTransactions";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/reverse", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await setCodeCryptographySecrets();

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
        chai.assert.equal(currency.code, "USD");
        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    afterEach(() => {
        sinonSandbox.restore();
    });


    describe("reversing initialBalance", () => {
        it("can reverse initialBalance", async () => {
            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 100
            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            const initialBalanceTransaction: Transaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET").then(tx => tx.body[0]);

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${initialBalanceTransaction.id}/reverse`, "POST", reverse);
            chai.assert.equal(postReverse.statusCode, 201);

            // chai.assert.deepEqualExcluding(postReverse.body, {
            //     "id": "3aa6ba55-741d-4f3e-b",
            //     "transactionType": "reverse",
            //     "currency": "USD",
            //     "totals": null,
            //     "lineItems": null,
            //     "steps": [
            //         {
            //             "rail": "lightrail",
            //             "valueId": "c38f0e47-a03e-4a8a-9",
            //             "contactId": null,
            //             "code": null,
            //             "balanceBefore": 100,
            //             "balanceAfter": 0,
            //             "balanceChange": -100,
            //             "usesRemainingBefore": null,
            //             "usesRemainingAfter": null,
            //             "usesRemainingChange": 0
            //         }
            //     ],
            //     "paymentSources": null,
            //     "metadata": null,
            // }, ["createdDate"])
        });
    });

    describe("reversing debits", () => {
        it("can reverse a debit with balance", async () => {
            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 100
            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            // create debit
            const debit: DebitRequest = {
                id: generateId(),
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 50,
                currency: "USD"
            };
            const postDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
            chai.assert.equal(postDebit.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
            chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);

            // check value is same as before
            const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
        });

        it("can reverse a debit with balanceRule and usesRemaining", async () => {
            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balanceRule: {
                    rule: "100",
                    explanation: "$1"
                },
                usesRemaining: 1,
                discount: true

            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            // create debit
            const checkout: CheckoutRequest = {
                id: generateId(),
                sources: [{
                    rail: "lightrail",
                    valueId: value.id
                }],
                lineItems: [{
                    productId: "123",
                    unitPrice: 100
                }],
                currency: "USD"
            };
            const postCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
            chai.assert.equal(postCheckout.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse);
            chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);
            verifyCheckoutReverseTotals(postCheckout.body, postReverse.body);

            // check value is same as before
            const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
        });
    });

    describe("reversing checkouts", () => {
        if (!testStripeLive()) {
            it("can reverse a checkout with balance and tok_visa", async () => {
                // create value
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 100
                };
                const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
                chai.assert.equal(postValue.statusCode, 201);

                // create checkout
                const checkout: CheckoutRequest = {
                    id: generateId(),
                    lineItems: [{
                        unitPrice: 250
                    }],
                    currency: "USD",
                    sources: [
                        {
                            rail: "lightrail",
                            valueId: value.id
                        },
                        {
                            rail: "stripe",
                            source: "tok_visa",
                        }
                    ]
                };

                const mockCharge = {
                    "id": "ch_1DJrEhG3cz9DRdBt5C8kJywD",
                    "object": "charge",
                    "amount": 150,
                    "amount_refunded": 0,
                    "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
                    "application_fee": null,
                    "balance_transaction": "txn_1DJrEhG3cz9DRdBtmSD458ek",
                    "captured": true,
                    "created": 1539214623,
                    "currency": "usd",
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
                        "lightrailTransactionId": "8cfec752-7baf-437b-a",
                        "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"3696a20a-00fc-4381-8\"},{\"rail\":\"stripe\",\"source\":\"tok_visa\"}]",
                        "lightrailUserId": "default-test-user-TEST"
                    },
                    "on_behalf_of": null,
                    "order": null,
                    "outcome": {
                        "network_status": "approved_by_network",
                        "reason": null,
                        "risk_level": "normal",
                        "risk_score": 1,
                        "seller_message": "Payment complete.",
                        "type": "authorized"
                    },
                    "paid": true,
                    "payment_intent": null,
                    "receipt_email": null,
                    "receipt_number": null,
                    "refunded": false,
                    "refunds": {
                        "object": "list",
                        "data": [],
                        "has_more": false,
                        "total_count": 0,
                        "url": "/v1/charges/ch_1DJrEhG3cz9DRdBt5C8kJywD/refunds"
                    },
                    "review": null,
                    "shipping": null,
                    "source": {
                        "id": "card_1DJrEhG3cz9DRdBtdPdVeocl",
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
                        "exp_month": 10,
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
                sinonSandbox.stub(stripeTransactions, "createCharge")
                    .withArgs(sinon.match({
                        amount: 150,
                        currency: "USD",
                        source: "tok_visa"
                    }), sinon.match("test"), sinon.match("test"), sinon.match(`${checkout.id}-0`)).resolves(mockCharge);

                const postCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
                chai.assert.equal(postCheckout.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);

                // create reverse
                const mockRefund = {
                    "id": "ch_1DJrEhG3cz9DRdBt5C8kJywD",
                    "object": "refund",
                    "amount": 150,
                    "balance_transaction": "txn_1DJrPcG3cz9DRdBtKuhccbBC",
                    "charge": "ch_1DJrPaG3cz9DRdBtxc6bo6FE",
                    "created": 1539215300,
                    "currency": "usd",
                    "metadata": {"reason": "not specified"},
                    "reason": null,
                    "receipt_number": null,
                    "source_transfer_reversal": null,
                    "status": "succeeded"
                };
                sinonSandbox.stub(stripeTransactions, "createRefund")
                    .withArgs(sinon.match({
                        "amount": 150,
                        "chargeId": "ch_1DJrEhG3cz9DRdBt5C8kJywD"
                    }), sinon.match("test"), sinon.match("test")).resolves(mockRefund);

                const reverse: Partial<ReverseRequest> = {
                    id: generateId()
                };
                const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse);
                chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);

                // check value is same as before
                const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
                chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
            });
        }
        if (testStripeLive()) {
            it("can reverse a checkout with balance and tok_visa", async () => {
                // create value
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 100
                };
                const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
                chai.assert.equal(postValue.statusCode, 201);

                // create checkout
                const checkout: CheckoutRequest = {
                    id: generateId(),
                    lineItems: [{
                        unitPrice: 250
                    }],
                    currency: "USD",
                    sources: [
                        {
                            rail: "internal",
                            beforeLightrail: true,
                            balance: 1,
                            internalId: "id"
                        },
                        {
                            rail: "lightrail",
                            valueId: value.id
                        },
                        {
                            rail: "stripe",
                            source: "tok_visa",
                            maxAmount: 50
                        },
                        {
                            rail: "stripe",
                            source: "tok_visa",
                            maxAmount: 200
                        }
                    ]
                };
                const postCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
                chai.assert.equal(postCheckout.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);
                chai.assert.equal((postCheckout.body.steps[0] as InternalTransactionStep).balanceChange, -1, `body=${JSON.stringify(postCheckout.body)}`);
                chai.assert.equal((postCheckout.body.steps[1] as LightrailTransactionStep).balanceChange, -100, `body=${JSON.stringify(postCheckout.body)}`);
                chai.assert.equal((postCheckout.body.steps[2] as StripeTransactionStep).amount, -50, `body=${JSON.stringify(postCheckout.body)}`);
                chai.assert.equal((postCheckout.body.steps[3] as StripeTransactionStep).amount, -99, `body=${JSON.stringify(postCheckout.body)}`);

                // lookup chain
                const getChain1 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${checkout.id}/chain`, "GET");
                chai.assert.equal(getChain1.body.length, 1);

                // create reverse
                const reverse: Partial<ReverseRequest> = {
                    id: generateId()
                };
                const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse);
                chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);

                // check value is same as before
                const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
                chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");
                chai.assert.isNotNull(postCheckout.body.steps.find(step => step.rail === "internal" && step.balanceChange === 1));
                chai.assert.isNotNull(postCheckout.body.steps.find(step => step.rail === "lightrail" && step.balanceChange === 100));
                chai.assert.isNotNull(postCheckout.body.steps.find(step => step.rail === "stripe" && step.amount === 50));
                chai.assert.isNotNull(postCheckout.body.steps.find(step => step.rail === "stripe" && step.amount === 99));

                // lookup chain2
                const getChain2 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${checkout.id}/chain`, "GET");
                chai.assert.equal(getChain2.body.length, 2);
            }).timeout(10000);
        }
    });

    function verifyCheckoutReverseTotals(checkout: Transaction, reverse: Transaction): void {
        for (const key of Object.keys(checkout.totals)) {
            console.log("key " + key + ". " + reverse.totals[key] + " == " + -checkout.totals[key]);
            chai.assert.equal(reverse.totals[key], -checkout.totals[key]);
        }
    }

});

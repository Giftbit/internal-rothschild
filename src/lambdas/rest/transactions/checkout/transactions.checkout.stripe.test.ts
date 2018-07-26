import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values";
import * as currencies from "../../currencies";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as sinon from "sinon";
import {Value} from "../../../../model/Value";
import {StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {Currency} from "../../../../model/Currency";
import * as kvsAccess from "../../../../utils/kvsAccess";
import {TransactionPlanError} from "../TransactionPlanError";
import * as insertTransaction from "../insertTransactions";
import * as testUtils from "../../../../utils/testUtils";
import {generateId} from "../../../../utils/testUtils";
import {after} from "mocha";
import * as stripeTransactions from "../../../../utils/stripeUtils/stripeTransactions";
import {
    setStubsForStripeTests,
    stripeEnvVarsPresent,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import {StripeRestError} from "../../../../utils/stripeUtils/StripeRestError";
import chaiExclude = require("chai-exclude");
import Stripe = require("stripe");
import ICharge = Stripe.charges.ICharge;

chai.use(chaiExclude);

require("dotenv").config();

describe("split tender checkout with Stripe", () => {
    const router = new cassava.Router();

    const value: Partial<Value> = {
        id: "value-for-checkout-w-stripe",
        currency: "CAD",
        balance: 100
    };
    const source: string = "tok_visa";
    const basicRequest = {
        id: "CO-stripe",
        sources: [
            {
                rail: "lightrail",
                valueId: value.id
            },
            {
                rail: "stripe",
                source: source
            }
        ],
        lineItems: [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 500
            }
        ],
        currency: "CAD"
    };

    const testStripeLive: boolean = !!process.env["TEST_STRIPE_LIVE"];

    before(async function () {
        if (!stripeEnvVarsPresent() && testStripeLive) {
            this.skip();
            return;
        }

        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        currencies.installCurrenciesRest(router);

        const currency: Currency = {
            code: "CAD",
            name: "Monopoly Money",
            symbol: "$",
            decimalPlaces: 2
        };
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    afterEach(() => {
        if (!testStripeLive) {
            if ((stripeTransactions.createStripeCharge as sinon).restore) {
                (stripeTransactions.createStripeCharge as sinon).restore();
            }
        }
    });

    it("processes basic checkout with Stripe only", async () => {
        const exampleStripeResponse: ICharge = {
            "id": "ch_1CruzHG3cz9DRdBtUyQrTT7L",
            "object": "charge",
            "amount": 123,
            "amount_refunded": 0,
            "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
            "application_fee": null,
            "balance_transaction": "txn_1CruzHG3cz9DRdBtQFbULLwg",
            "captured": true,
            "created": 1532555859,
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
                "lightrailTransactionId": "CO-stripe-only",
                "lightrailTransactionSources": "[]",
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
                "url": "/v1/charges/ch_1CruzHG3cz9DRdBtUyQrTT7L/refunds"
            },
            "review": null,
            "shipping": null,
            "source": {
                "id": "card_1CruzHG3cz9DRdBtBFFtS5hy",
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
        if (!testStripeLive) {
            const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
            stripeStub.withArgs(sinon.match.object, sinon.match.string, sinon.match.string, sinon.match.string).resolves(exampleStripeResponse);
        }

        const request = {
            id: "CO-stripe-only",
            sources: [
                {
                    rail: "stripe",
                    source: source
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 123
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 123,
            tax: 0,
            discount: 0,
            payable: 123,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 123,
                quantity: 1,
                lineTotal: {
                    subtotal: 123,
                    taxable: 123,
                    tax: 0,
                    discount: 0,
                    payable: 123,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "stripe",
                chargeId: "exampleStripeResponse.id",
                amount: -123,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            source: "tok_visa",
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive) {
            chai.assert.equal((postCheckoutResp.body.steps[0] as StripeTransactionStep).chargeId, exampleStripeResponse.id);
            chai.assert.deepEqual((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge, exampleStripeResponse, `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        }

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it("processes basic checkout with Stripe only - `customer` as payment source", async () => {
        const exampleStripeResponse: ICharge = {
            "id": "ch_1CsHqTG3cz9DRdBtw5jcQdu2",
            "object": "charge",
            "amount": 123,
            "amount_refunded": 0,
            "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
            "application_fee": null,
            "balance_transaction": "txn_1CsHqUG3cz9DRdBti9r3om5w",
            "captured": true,
            "created": 1532643725,
            "currency": "cad",
            "customer": "cus_D7DGMRDFa4BV4U",
            "description": null,
            "destination": null,
            "dispute": null,
            "failure_code": null,
            "failure_message": null,
            "fraud_details": {},
            "invoice": null,
            "livemode": false,
            "metadata": {
                "lightrailTransactionId": "CO-stripe-cust",
                "lightrailTransactionSources": "[]",
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
                "url": "/v1/charges/ch_1CsHqTG3cz9DRdBtw5jcQdu2/refunds"
            },
            "review": null,
            "shipping": null,
            "source": {
                "id": "card_1CgypnG3cz9DRdBtQRfxFg4A",
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
                "customer": "cus_D7DGMRDFa4BV4U",
                "cvc_check": null,
                "dynamic_last4": null,
                "exp_month": 4,
                "exp_year": 2024,
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
        if (!testStripeLive) {
            const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
            stripeStub.withArgs(sinon.match.object, sinon.match.string, sinon.match.string, sinon.match.string).resolves(exampleStripeResponse);
        }

        const request = {
            id: "CO-stripe-cust",
            sources: [
                {
                    rail: "stripe",
                    customer: process.env["STRIPE_CUSTOMER_ID"]
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 123
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 123,
            tax: 0,
            discount: 0,
            payable: 123,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 123,
                quantity: 1,
                lineTotal: {
                    subtotal: 123,
                    taxable: 123,
                    tax: 0,
                    discount: 0,
                    payable: 123,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "stripe",
                chargeId: "",
                amount: -123,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            customer: process.env["STRIPE_CUSTOMER_ID"],
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive) {
            chai.assert.equal((postCheckoutResp.body.steps[0] as StripeTransactionStep).chargeId, exampleStripeResponse.id);
            chai.assert.deepEqual((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge, exampleStripeResponse, `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        }

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it("process basic split tender checkout", async () => {
        const exampleStripeResponse: ICharge = {
            "id": "ch_1CsIaFG3cz9DRdBtUZz7KeWp",
            "object": "charge",
            "amount": 400,
            "amount_refunded": 0,
            "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
            "application_fee": null,
            "balance_transaction": "txn_1CsIaFG3cz9DRdBtK4nhlltC",
            "captured": true,
            "created": 1532646563,
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
                "lightrailTransactionId": "CO-stripe",
                "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"value-for-checkout-w-stripe\"}]",
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
                "url": "/v1/charges/ch_1CsIaFG3cz9DRdBtUZz7KeWp/refunds"
            },
            "review": null,
            "shipping": null,
            "source": {
                "id": "card_1CsIaFG3cz9DRdBtrYRgnCOM",
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
        if (!testStripeLive) {
            const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
            stripeStub.withArgs(sinon.match.object, sinon.match.string, sinon.match.string, sinon.match.string).resolves(exampleStripeResponse);
        }

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", basicRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, basicRequest.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            payable: 500,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 500,
                quantity: 1,
                lineTotal: {
                    subtotal: 500,
                    taxable: 500,
                    tax: 0,
                    discount: 0,
                    payable: 500,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: value.id,
                code: null,
                contactId: null,
                balanceBefore: 100,
                balanceAfter: 0,
                balanceChange: -100
            },
            {
                rail: "stripe",
                chargeId: "",
                amount: -400,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "lightrail",
            valueId: value.id
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[1], {
            rail: "stripe",
            source: "tok_visa",
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive) {
            chai.assert.equal((postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).chargeId, exampleStripeResponse.id);
            chai.assert.deepEqual((postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).charge, exampleStripeResponse, `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        }

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${basicRequest.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it("does not charge Stripe when Lightrail value is sufficient", async () => {
        if (!testStripeLive) {
            const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
            stripeStub.rejects(new Error("The Stripe stub should never be called in this test"));
        }

        const sufficientValue: Partial<Value> = {
            id: "CO-sufficient-value",
            currency: "CAD",
            balance: 1000
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", sufficientValue);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const request = {
            id: "checkout-stripe-not-charged",
            sources: [
                {
                    rail: "lightrail",
                    valueId: sufficientValue.id
                },
                {
                    rail: "stripe",
                    source: source
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 500
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            payable: 500,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 500,
                quantity: 1,
                lineTotal: {
                    subtotal: 500,
                    taxable: 500,
                    tax: 0,
                    discount: 0,
                    payable: 500,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqual(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: sufficientValue.id,
                code: null,
                contactId: null,
                balanceBefore: 1000,
                balanceAfter: 500,
                balanceChange: -500
            }
        ], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources, [
            {
                rail: "lightrail",
                valueId: sufficientValue.id
            },
            {
                rail: "stripe",
                source: "tok_visa",
            }
        ], `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${sufficientValue.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 500);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);

    });

    it("posts the LR transaction identifier as metadata on the Stripe charge", async () => {
        if (!testStripeLive) {
            console.log("Skipping test that currently requires live call to Stripe");
            return;
        }

        const lrCheckoutTransaction = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${basicRequest.id}`, "GET");  // created in first split tender test

        const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
        const stripeChargeId = (lrCheckoutTransaction.body.paymentSources.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
        const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
            stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
        });

        chai.assert.deepEqual(stripeCharge.metadata, {
            lightrailTransactionId: basicRequest.id,
            "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"value-for-checkout-w-stripe\"}]",
            "lightrailUserId": "default-test-user-TEST"
        });
    });

    it("writes metadata to both LR & Stripe transactions", async () => {
        if (!testStripeLive) {
            console.log("Skipping test that currently requires live call to Stripe");
            return;
        }

        const request = {
            ...basicRequest,
            id: generateId(),
            metadata: {"meta": "data"}
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.metadata, request.metadata, `body.metadata=${postCheckoutResp.body.metadata}`);

        const stripeStep = postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep;
        chai.assert.deepEqual(stripeStep.charge.metadata, {
            ...request.metadata,
            lightrailTransactionId: request.id,
            "lightrailTransactionSources": "[]", // lightrail value is used up by now
            "lightrailUserId": "default-test-user-TEST"
        });

        const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
        const stripeChargeId = (postCheckoutResp.body.paymentSources.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
        const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
            stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
        });

        chai.assert.deepEqual(stripeCharge.metadata, stripeStep.charge.metadata);
    });

    describe.skip("respects 'maxAmount' limit on Stripe source", async () => {
        // Should handle multiple cases:
        // - if LR value is sufficient, Stripe shouldn't even be assessed for its maxAmount
        // - if LR value is not sufficient and Stripe maxAmount is hit, throw a clear error
        // - if multiple Stripe sources are specified, use them in order and respect the maxAmount on each
        // These calculations happen during plan step calculation
    });

    it("does not charge Stripe when 'simulate: true'", async () => {
        unsetStubsForStripeTests();

        const valueForSimulate: Partial<Value> = {
            id: "value-for-checkout-simulation",
            currency: "CAD",
            balance: 100
        };

        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueForSimulate);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);
        chai.assert.equal(createValue.body.balance, 100, `body=${JSON.stringify(createValue.body)}`);

        let request = {
            ...basicRequest,
            id: "CO-simulation-w-stripe",
            simulate: true
        };
        request.sources[0] = {
            rail: "lightrail",
            valueId: valueForSimulate.id
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 200, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            payable: 500,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 500,
                quantity: 1,
                lineTotal: {
                    subtotal: 500,
                    taxable: 500,
                    tax: 0,
                    discount: 0,
                    payable: 500,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqual(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: valueForSimulate.id,
                code: null,
                contactId: null,
                balanceBefore: 100,
                balanceAfter: 0,
                balanceChange: -100
            },
            {
                rail: "stripe",
                chargeId: null,
                amount: -400,
                charge: null
            }
        ], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "lightrail",
            valueId: valueForSimulate.id
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[1], {
            rail: "stripe",
            source: "tok_visa",
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);


        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueForSimulate.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 100, "the value did not actually change");

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 404, "the transaction was not actually created");

        setStubsForStripeTests();
        chai.assert.deepEqual(await giftbitRoutes.secureConfig.fetchFromS3ByEnvVar("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE"), {
            email: "test@test.com",
            test: {
                clientId: "test-client-id",
                secretKey: process.env["STRIPE_PLATFORM_KEY"],
                publishableKey: "test-pk",
            },
            live: {},
        });
        chai.assert.deepEqual(await kvsAccess.kvsGet("this-is-an-assume-token", "stripeAuth", ""), {
            token_type: "bearer",
            stripe_user_id: process.env["STRIPE_CONNECTED_ACCOUNT_ID"],
        });
    });

    it.skip("creates a charge auth in Stripe when 'pending: true'");

    it.skip("captures Lightrail and Stripe charges together");

    describe("rollback", () => {
        before(function () {
            if (!stripeEnvVarsPresent()) {
                this.skip();
                return;
            }
        });

        it("passes on the Stripe error", async () => {
            if (testStripeLive) {
                const stripeChargeRequest = {
                    amount: 55,
                    currency: "CAD",
                    source: "tok_visa"
                };
                const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
                await lightrailStripe.charges.create(stripeChargeRequest, {
                    stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"],
                    idempotency_key: "bad-idempotent-key-0"
                });
            } else {
                const exampleStripeError = {
                    "type": "StripeIdempotencyError",
                    "stack": "Error: Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'bad-idempotent-key-0' if you meant to execute a different request.\n    at Constructor._Error (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Function.StripeError.generate (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:61:12)\n    at IncomingMessage.<anonymous> (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/StripeResource.js:170:39)\n    at emitNone (events.js:110:20)\n    at IncomingMessage.emit (events.js:207:7)\n    at endReadableNT (_stream_readable.js:1059:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
                    "rawType": "idempotency_error",
                    "message": "Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'bad-idempotent-key-0' if you meant to execute a different request.",
                    "raw": {
                        "message": "Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'bad-idempotent-key-0' if you meant to execute a different request.",
                        "type": "idempotency_error",
                        "headers": {
                            "server": "nginx",
                            "date": "Thu, 26 Jul 2018 23:46:18 GMT",
                            "content-type": "application/json",
                            "content-length": "243",
                            "connection": "close",
                            "access-control-allow-credentials": "true",
                            "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                            "access-control-allow-origin": "*",
                            "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                            "access-control-max-age": "300",
                            "cache-control": "no-cache, no-store",
                            "idempotency-key": "bad-idempotent-key-0",
                            "request-id": "req_pKaP2QTnOweLxJ",
                            "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                            "stripe-version": "2018-05-21",
                            "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                        },
                        "statusCode": 400,
                        "requestId": "req_pKaP2QTnOweLxJ"
                    },
                    "headers": {
                        "server": "nginx",
                        "date": "Thu, 26 Jul 2018 23:46:18 GMT",
                        "content-type": "application/json",
                        "content-length": "243",
                        "connection": "close",
                        "access-control-allow-credentials": "true",
                        "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                        "access-control-allow-origin": "*",
                        "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                        "access-control-max-age": "300",
                        "cache-control": "no-cache, no-store",
                        "idempotency-key": "bad-idempotent-key-0",
                        "request-id": "req_pKaP2QTnOweLxJ",
                        "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                        "stripe-version": "2018-05-21",
                        "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                    },
                    "requestId": "req_pKaP2QTnOweLxJ",
                    "statusCode": 400
                };
                const exampleErrorResponse = new StripeRestError(409, "Error for tests", null, exampleStripeError);
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.withArgs(sinon.match.object, sinon.match.string, sinon.match.string, sinon.match.string).rejects(exampleErrorResponse);
            }

            const request = {
                ...basicRequest,
                id: "bad-idempotent-key"
            };
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
        }).timeout(4000);

        it("rolls back the Stripe transaction when the Lightrail transaction fails", async () => {
            let stubProcessLightrailTransactionSteps = sinon.stub(insertTransaction, "insertLightrailTransactionSteps");
            stubProcessLightrailTransactionSteps.throws(new TransactionPlanError("error for tests", {isReplanable: false}));

            const request = {
                ...basicRequest,
                id: `rollback-${Math.random()}`  // needs to be generated for every test so the Stripe refund succeeds (charges use idempotency keys, refunds can't)
            };
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 500, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
            // todo check that metadata on Stripe charge gets updated with refund note

            (insertTransaction.insertLightrailTransactionSteps as any).restore();
        }).timeout(3500);

        it("throws 409 'transaction already exists' if the Lightrail transaction fails for idempotency reasons", async () => {
            let stubInsertTransaction = sinon.stub(insertTransaction, "insertTransaction");
            stubInsertTransaction.withArgs(sinon.match.any, sinon.match.any, sinon.match.any).throws(new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId 'TEST-ID-IRRELEVANT' already exists.`, "TransactionExists"));
            const request = {
                ...basicRequest,
                id: `rollback-test-2-${Math.random()}`  // needs to be generated for every test so the Stripe refund succeeds (charges use idempotency keys, refunds can't)
            };

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
            chai.assert.equal((postCheckoutResp.body as any).messageCode, "TransactionExists", `messageCode=${(postCheckoutResp.body as any).messageCode}`);

            (insertTransaction.insertTransaction as any).restore();
        }).timeout(3000);

        it("handles idempotency errors: fails the repeated transaction but doesn't roll back the original Stripe charge", async () => {
            if (!testStripeLive) {
                console.log("Skipping test that currently requires live call to Stripe");
                return;
            }

            const request = {
                id: "idempotency-check-7",
                sources: [
                    {
                        rail: "stripe",
                        source: source
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 123
                    }
                ],
                currency: "CAD"
            };
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);

            // post the same charge a second time to trigger LR idempotency failure
            const postCheckoutResp2 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp2.statusCode, 409, `body=${JSON.stringify(postCheckoutResp2.body)}`);

            // get the stripe charge and make sure that it hasn't been refunded
            const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
            const stripeChargeId = (postCheckoutResp.body.paymentSources.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
            const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
            });
            chai.assert.equal(stripeCharge.refunded, false, `stripeCharge first GET: check 'refunded': ${JSON.stringify(stripeCharge)}`);
            chai.assert.equal(stripeCharge.amount_refunded, 0, `stripeCharge first GET: check 'amount_refunded': ${JSON.stringify(stripeCharge)}`);

            // post the same charge a third time - if the stripe charge got refunded, this will crash and burn
            const postCheckoutResp3 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp3.statusCode, 409, `body=${JSON.stringify(postCheckoutResp3.body)}`);

            // make sure the original stripe charge still hasn't been affected
            const stripeCharge2 = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
            });
            chai.assert.equal(stripeCharge2.refunded, 0, `stripeCharge second GET: check 'refunded': ${JSON.stringify(stripeCharge)}`);
            chai.assert.equal(stripeCharge2.amount_refunded, false, `stripeCharge second GET: check 'amount_refunded': ${JSON.stringify(stripeCharge)}`);
        }).timeout(4000);
    });

    it("processes split tender checkout with two Stripe sources", async () => {
        // todo - if we keep 'priority' in requested Stripe sources, check that sources are charged in the right order

        const exampleStripeResponse1: ICharge = {
            "id": "ch_1CsIaIG3cz9DRdBtLhgwcYtV",
            "object": "charge",
            "amount": 100,
            "amount_refunded": 0,
            "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
            "application_fee": null,
            "balance_transaction": "txn_1CsIaIG3cz9DRdBtCSH0yxJr",
            "captured": true,
            "created": 1532646566,
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
                "lightrailTransactionId": "CO-2-stripe-srcs",
                "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"value-for-checkout2\"},{\"rail\":\"stripe\",\"source\":\"tok_mastercard\"}]",
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
                "url": "/v1/charges/ch_1CsIaIG3cz9DRdBtLhgwcYtV/refunds"
            },
            "review": null,
            "shipping": null,
            "source": {
                "id": "card_1CsIaIG3cz9DRdBtyqDybWJC",
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
        const exampleStripeResponse2: ICharge = {
            "id": "ch_1CsIaJG3cz9DRdBtBZ32vP6Z",
            "object": "charge",
            "amount": 300,
            "amount_refunded": 0,
            "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
            "application_fee": null,
            "balance_transaction": "txn_1CsIaJG3cz9DRdBtGahzywqj",
            "captured": true,
            "created": 1532646567,
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
                "lightrailTransactionId": "CO-2-stripe-srcs",
                "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"value-for-checkout2\"},{\"rail\":\"stripe\",\"source\":\"tok_visa\"}]",
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
                "url": "/v1/charges/ch_1CsIaJG3cz9DRdBtBZ32vP6Z/refunds"
            },
            "review": null,
            "shipping": null,
            "source": {
                "id": "card_1CsIaJG3cz9DRdBtVmGKbpuX",
                "object": "card",
                "address_city": null,
                "address_country": null,
                "address_line1": null,
                "address_line1_check": null,
                "address_line2": null,
                "address_state": null,
                "address_zip": null,
                "address_zip_check": null,
                "brand": "MasterCard",
                "country": "US",
                "customer": null,
                "cvc_check": null,
                "dynamic_last4": null,
                "exp_month": 7,
                "exp_year": 2019,
                "fingerprint": "0VsQjdIRLOfd1eWk",
                "funding": "credit",
                "last4": "4444",
                "metadata": {},
                "name": null,
                "tokenization_method": null
            },
            "source_transfer": null,
            "statement_descriptor": null,
            "status": "succeeded",
            "transfer_group": null
        };
        if (!testStripeLive) {
            const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
            stripeStub.onFirstCall().resolves(exampleStripeResponse1);
            stripeStub.onSecondCall().resolves(exampleStripeResponse2);
        }

        const value2: Partial<Value> = {
            id: "value-for-checkout2",
            currency: "CAD",
            balance: 100
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const source2 = "tok_mastercard";
        const request = {
            id: "CO-2-stripe-srcs",
            sources: [
                {
                    rail: "lightrail",
                    valueId: value2.id
                },
                {
                    rail: "stripe",
                    source: source,
                    maxAmount: 100
                },
                {
                    rail: "stripe",
                    source: source2
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 500
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            payable: 500,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 500,
                quantity: 1,
                lineTotal: {
                    subtotal: 500,
                    taxable: 500,
                    tax: 0,
                    discount: 0,
                    payable: 500,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: value2.id,
                code: null,
                contactId: null,
                balanceBefore: 100,
                balanceAfter: 0,
                balanceChange: -100
            },
            {
                rail: "stripe",
                chargeId: "",
                amount: -100,
                charge: null
            },
            {
                rail: "stripe",
                chargeId: "",
                amount: -300,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.isNotNull(postCheckoutResp.body.steps[1]["chargeId"]);
        chai.assert.isNotNull(postCheckoutResp.body.steps[1]["charge"]);
        chai.assert.isNotNull(postCheckoutResp.body.steps[2]["chargeId"]);
        chai.assert.isNotNull(postCheckoutResp.body.steps[2]["charge"]);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "lightrail",
            valueId: value2.id
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[1], {
            rail: "stripe",
            source: "tok_visa",
            maxAmount: 100,
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[2], {
            rail: "stripe",
            source: "tok_mastercard",
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive) {
            chai.assert.deepEqual((postCheckoutResp.body.steps[1] as StripeTransactionStep).charge, exampleStripeResponse1);
            chai.assert.deepEqual((postCheckoutResp.body.steps[2] as StripeTransactionStep).charge, exampleStripeResponse2);
        }

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value2.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body, null, 4)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    }).timeout(3000);

    describe("respects Stripe minimum charge of $0.50", () => {
        before(function () {
            if (!stripeEnvVarsPresent()) {
                this.skip();
                return;
            }
        });

        it("fails the transaction by default", async () => {
            const exampleStripeError = {
                "type": "StripeInvalidRequestError",
                "stack": "Error: Amount must be at least 50 cents\n    at Constructor._Error (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Function.StripeError.generate (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:57:12)\n    at IncomingMessage.<anonymous> (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/StripeResource.js:170:39)\n    at emitNone (events.js:110:20)\n    at IncomingMessage.emit (events.js:207:7)\n    at endReadableNT (_stream_readable.js:1059:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
                "rawType": "invalid_request_error",
                "code": "amount_too_small",
                "param": "amount",
                "message": "Amount must be at least 50 cents",
                "raw": {
                    "code": "amount_too_small",
                    "doc_url": "https://stripe.com/docs/error-codes/amount-too-small",
                    "message": "Amount must be at least 50 cents",
                    "param": "amount",
                    "type": "invalid_request_error",
                    "headers": {
                        "server": "nginx",
                        "date": "Fri, 27 Jul 2018 16:46:00 GMT",
                        "content-type": "application/json",
                        "content-length": "234",
                        "connection": "close",
                        "access-control-allow-credentials": "true",
                        "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                        "access-control-allow-origin": "*",
                        "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                        "access-control-max-age": "300",
                        "cache-control": "no-cache, no-store",
                        "idempotency-key": "checkout-w-stripe-2-sources-0",
                        "original-request": "req_aNgELeJU4iIOu9",
                        "request-id": "req_TiojpYyiiKcPYA",
                        "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                        "stripe-version": "2018-05-21",
                        "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                    },
                    "statusCode": 400,
                    "requestId": "req_TiojpYyiiKcPYA"
                },
                "headers": {
                    "server": "nginx",
                    "date": "Fri, 27 Jul 2018 16:46:00 GMT",
                    "content-type": "application/json",
                    "content-length": "234",
                    "connection": "close",
                    "access-control-allow-credentials": "true",
                    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                    "access-control-allow-origin": "*",
                    "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                    "access-control-max-age": "300",
                    "cache-control": "no-cache, no-store",
                    "idempotency-key": "checkout-w-stripe-2-sources-0",
                    "original-request": "req_aNgELeJU4iIOu9",
                    "request-id": "req_TiojpYyiiKcPYA",
                    "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                    "stripe-version": "2018-05-21",
                    "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                },
                "requestId": "req_TiojpYyiiKcPYA",
                "statusCode": 400
            };
            const exampleErrorResponse = new StripeRestError(422, "Error for tests", null, exampleStripeError);
            if (!testStripeLive) {
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.withArgs(sinon.match.object, sinon.match.string, sinon.match.string, sinon.match.string).rejects(exampleErrorResponse);
            }

            const value3: Partial<Value> = {
                id: "value-for-checkout3",
                currency: "CAD",
                balance: 100
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value3);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const request = {
                id: "checkout-w-stripe-2-sources",
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value3.id
                    },
                    {
                        rail: "stripe",
                        source: source,
                    },
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 125
                    }
                ],
                currency: "CAD"
            };
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 422, `body=${JSON.stringify(postCheckoutResp.body)}`);

            if (!testStripeLive) {
                chai.assert.isNotNull((postCheckoutResp.body as any).stripeError);
                chai.assert.deepEqual((postCheckoutResp.body as any).stripeError, exampleStripeError);
            }
        });
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values/values";
import * as currencies from "../../currencies";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as sinon from "sinon";
import {Value} from "../../../../model/Value";
import {StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {Currency} from "../../../../model/Currency";
import {TransactionPlanError} from "../TransactionPlanError";
import * as insertTransaction from "../insertTransactions";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../../utils/testUtils";
import {after} from "mocha";
import {
    setStubsForStripeTests,
    stripeLiveLightrailConfig,
    stripeLiveMerchantConfig,
    stubCheckoutStripeCharge,
    stubCheckoutStripeError,
    stubNoStripeCharge,
    stubStripeRefund,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import {StripeRestError} from "../../../../utils/stripeUtils/StripeRestError";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import log = require("loglevel");
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
    const basicRequest: CheckoutRequest = {
        id: generateId(),
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

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
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

    const sinonSandbox = sinon.createSandbox();

    afterEach(() => {
        sinonSandbox.restore();
    });

    it("processes basic checkout with Stripe only", async () => {
        const request: CheckoutRequest = {
            id: generateId(),
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

        const [stripeResponse] = stubCheckoutStripeCharge(request, 0, 123);
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 123,
            tax: 0,
            discount: 0,
            discountLightrail: 0,
            payable: 123,
            paidInternal: 0,
            paidLightrail: 0,
            paidStripe: 123,
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
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps as StripeTransactionStep[], [
            {
                rail: "stripe",
                chargeId: "exampleStripeResponse.id",
                amount: -123,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            source: "tok_visa",
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive()) {
            chai.assert.equal((postCheckoutResp.body.steps[0] as StripeTransactionStep).chargeId, stripeResponse.id);
            chai.assert.deepEqual((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge, stripeResponse, `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        }

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `GET body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it("processes basic checkout with Stripe only - `customer` as payment source", async () => {
        const request: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "stripe",
                    customer: stripeLiveMerchantConfig.customer.id
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

        const [exampleStripeResponse] = stubCheckoutStripeCharge(request, 0, 123);
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 123,
            tax: 0,
            discount: 0,
            discountLightrail: 0,
            payable: 123,
            paidInternal: 0,
            paidLightrail: 0,
            paidStripe: 123,
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
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps as StripeTransactionStep[], [
            {
                rail: "stripe",
                chargeId: "",
                amount: -123,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            customer: stripeLiveMerchantConfig.customer.id,
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive()) {
            chai.assert.equal((postCheckoutResp.body.steps[0] as StripeTransactionStep).chargeId, exampleStripeResponse.id);
            chai.assert.deepEqual((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge, exampleStripeResponse, `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        }

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    }).timeout(10000);

    it("checkout with multiple payment sources that result in multiple permutations should not over calculate the stripe charge amount", async () => {
        const promoA: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "0",
                explanation: "zero the hard way"
            }
        };
        const createPromoA = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", promoA);
        chai.assert.equal(createPromoA.statusCode, 201);

        const promoB: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "0",
                explanation: "zero the hard way"
            }
        };
        const createPromoB = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", promoB);
        chai.assert.equal(createPromoB.statusCode, 201);

        const checkoutRequest: Partial<CheckoutRequest> = {
            id: generateId(),
            simulate: true,
            sources: [
                {
                    rail: "lightrail",
                    valueId: createPromoA.body.id
                },
                {
                    rail: "lightrail",
                    valueId: createPromoB.body.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
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

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(postCheckoutResp.body.totals.payable, 500);
        chai.assert.equal(postCheckoutResp.body.steps[0].rail, "stripe");
        chai.assert.equal(postCheckoutResp.body.steps[0]["amount"], -500);
    });

    it("processes a basic split tender checkout", async () => {
        const [exampleStripeResponse] = stubCheckoutStripeCharge(basicRequest, 1, 400);
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", basicRequest);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, basicRequest.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            discountLightrail: 0,
            payable: 500,
            paidInternal: 0,
            paidLightrail: 100,
            paidStripe: 400,
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
        chai.assert.deepEqualExcluding<any>(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: value.id,
                code: null,
                contactId: null,
                balanceBefore: 100,
                balanceAfter: 0,
                balanceChange: -100,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
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
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[1], {
            rail: "stripe",
            source: "tok_visa",
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive()) {
            chai.assert.equal((postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).chargeId, exampleStripeResponse.id);
            chai.assert.deepEqual((postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).charge, exampleStripeResponse, `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        }

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${basicRequest.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    }).timeout(10000);

    it("does not charge Stripe when Lightrail value is sufficient", async () => {
        const sufficientValue: Partial<Value> = {
            id: "CO-sufficient-value",
            currency: "CAD",
            balance: 1000
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", sufficientValue);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const request: CheckoutRequest = {
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
        stubNoStripeCharge(request);
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            discountLightrail: 0,
            payable: 500,
            paidInternal: 0,
            paidLightrail: 500,
            paidStripe: 0,
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
                balanceChange: -500,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
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
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);

    });

    it("posts the LR transaction identifier as metadata on the Stripe charge", async function () {  // oldschool function syntax: need 'this' in order to skip test if not running live
        // depends on first split tender test

        if (!testStripeLive()) {
            log.warn("this test verifies that Lightrail transaction information is saved to Stripe charges. Must be run live.");
            this.skip();
            return;
        }

        const lrCheckoutTransaction = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${basicRequest.id}`, "GET");  // created in first split tender test
        chai.assert.equal(lrCheckoutTransaction.statusCode, 200);

        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
        const stripeChargeId = (lrCheckoutTransaction.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).charge.id;
        const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
            stripe_account: stripeLiveMerchantConfig.stripeUserId
        });

        chai.assert.deepEqual(stripeCharge.metadata, {
            lightrailTransactionId: basicRequest.id,
            "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${value.id}\"}]`,
            "lightrailUserId": defaultTestUser.userId
        });
    });

    it("writes metadata to both LR & Stripe transactions", async function () {   // oldschool function syntax: need 'this' in order to skip test if not running live
        const request: CheckoutRequest = {
            id: generateId(),
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
                    unitPrice: 500
                }
            ],
            currency: "CAD",
            metadata: {"meta": "data"}
        };

        stubCheckoutStripeCharge(request, 0, 500);
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.metadata, request.metadata, `body.metadata=${postCheckoutResp.body.metadata}`);

        const stripeStep = postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep;
        chai.assert.deepEqual(stripeStep.charge.metadata, {
            ...request.metadata,
            lightrailTransactionId: request.id,
            "lightrailTransactionSources": "[]", // lightrail value is used up by now
            "lightrailUserId": defaultTestUser.auth.userId
        });

        if (testStripeLive()) {
            chai.assert.deepEqual(stripeStep.charge.metadata, {
                ...request.metadata,
                lightrailTransactionId: request.id,
                lightrailTransactionSources: "[]",
                lightrailUserId: defaultTestUser.userId
            });
        } else {
            chai.assert.deepEqualExcluding<Stripe.IMetadata>(stripeStep.charge.metadata, {
                ...request.metadata,
                lightrailTransactionSources: "[]",
                lightrailUserId: defaultTestUser.userId
            }, ["lightrailTransactionId"]);
        }

        if (testStripeLive()) {
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
            const stripeChargeId = (postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).chargeId;
            const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: stripeLiveMerchantConfig.stripeUserId
            });
            chai.assert.deepEqual(stripeCharge.metadata, stripeStep.charge.metadata);
        }
    }).timeout(10000);

    it("passes additionalStripeParams to Stripe", async () => {
        // This cannot be tested live with a dummy value.
        const onBehalfOf = testStripeLive() ? null : "aaa";

        const request: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "stripe",
                    source: source,
                    additionalStripeParams: {
                        description: "eee",
                        on_behalf_of: onBehalfOf,
                        receipt_email: "bbb@example.com",
                        shipping: {
                            address: {
                                city: "Beverly Hills",
                                country: "US",
                                line1: "1675 E. Altadena Drive",
                                line2: null,
                                postal_code: "90210",
                                state: "CA"

                            },
                            carrier: null,
                            name: "Henrietta",
                            phone: null,
                            tracking_number: "abc123"
                        },
                        statement_descriptor: "ccc",
                        transfer_group: "ddd"
                    }
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

        stubCheckoutStripeCharge(request, 0, 500, {
            description: "eee",
            on_behalf_of: onBehalfOf,
            receipt_email: "bbb@example.com",
            shipping: {
                address: {
                    city: "Beverly Hills",
                    country: "US",
                    line1: "1675 E. Altadena Drive",
                    line2: "",
                    postal_code: "90210",
                    state: "CA"

                },
                carrier: "",
                name: "Henrietta",
                phone: "",
                tracking_number: "abc123"
            },
            statement_descriptor: "ccc",
            transfer_group: "ddd"
        });
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);

        const stripeStep = postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep;
        chai.assert.isObject(stripeStep, "found stripe step");
        chai.assert.equal(stripeStep.charge.description, "eee");
        chai.assert.equal((stripeStep.charge as ICharge).on_behalf_of, onBehalfOf);
        chai.assert.equal((stripeStep.charge as ICharge).receipt_email, "bbb@example.com");
        chai.assert.equal((stripeStep.charge as ICharge).statement_descriptor, "ccc");
        chai.assert.equal((stripeStep.charge as ICharge).transfer_group, "ddd");
        chai.assert.deepEqual((stripeStep.charge as ICharge).shipping, {
            address: {
                city: "Beverly Hills",
                country: "US",
                line1: "1675 E. Altadena Drive",
                line2: "",
                postal_code: "90210",
                state: "CA"

            },
            carrier: "",
            name: "Henrietta",
            phone: "",
            tracking_number: "abc123"
        });

        if (testStripeLive()) {
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
            const stripeChargeId = (postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).chargeId;
            const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: stripeLiveMerchantConfig.stripeUserId
            });
            chai.assert.deepEqual(stripeCharge.metadata, stripeStep.charge.metadata);
        }
    }).timeout(10000);

    it("does not charge Stripe when 'simulate: true'", async () => {
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
            discountLightrail: 0,
            payable: 500,
            paidInternal: 0,
            paidLightrail: 100,
            paidStripe: 400,
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
                balanceChange: -100,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
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
    });

    describe("rollback", () => {
        it("passes on the Stripe error", async () => {
            const request = {
                ...basicRequest,
                id: "bad_idempotent_key"
            };

            if (testStripeLive()) {
                const stripeChargeRequest = {
                    amount: 55,
                    currency: "CAD",
                    source: "tok_visa"
                };
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
                await lightrailStripe.charges.create(stripeChargeRequest, {
                    stripe_account: stripeLiveMerchantConfig.stripeUserId,
                    idempotency_key: "bad_idempotent_key-0"
                });
            } else {
                const exampleStripeError = {
                    "type": "StripeIdempotencyError",
                    "stack": "Error: Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'bad_idempotent_key-0' if you meant to execute a different request.\n    at Constructor._Error (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Function.StripeError.generate (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:61:12)\n    at IncomingMessage.<anonymous> (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/StripeResource.js:170:39)\n    at emitNone (events.js:110:20)\n    at IncomingMessage.emit (events.js:207:7)\n    at endReadableNT (_stream_readable.js:1059:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
                    "rawType": "idempotency_error",
                    "message": "Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'bad_idempotent_key-0' if you meant to execute a different request.",
                    "raw": {
                        "message": "Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'bad_idempotent_key-0' if you meant to execute a different request.",
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
                            "idempotency-key": "bad_idempotent_key-0",
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
                        "idempotency-key": "bad_idempotent_key-0",
                        "request-id": "req_pKaP2QTnOweLxJ",
                        "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                        "stripe-version": "2018-05-21",
                        "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                    },
                    "requestId": "req_pKaP2QTnOweLxJ",
                    "statusCode": 400
                };
                const exampleErrorResponse = new StripeRestError(409, "Error for tests", null, exampleStripeError);

                // getStripeChargeStub({transactionId: request.id}).rejects(exampleErrorResponse);
                stubCheckoutStripeError(request, 1, exampleErrorResponse);
            }

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
        }).timeout(10000);

        it("does not charge Stripe when the Lightrail parent transaction fails", async () => {
            // Non-replanable transaction errors bubble up to the router.
            sinonSandbox.stub(router, "errorHandler")
                .callsFake(err => log.debug("router.errorHandler", err));
            sinonSandbox.stub(insertTransaction, "insertTransaction")
                .rejects(new TransactionPlanError("Error for tests: inserting checkout parent transaction", {isReplanable: false}));

            const request = {
                ...basicRequest,
                id: generateId()
            };
            stubNoStripeCharge(request);
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 500, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
        }).timeout(10000);

        it("rolls back the Stripe transaction when the Lightrail transaction steps fail", async () => {
            const value4: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 100
            };

            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value4);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const request: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value4.id
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
            const [exampleStripeCharge, stripeChargeStub] = stubCheckoutStripeCharge(request, 1, 400);
            const [exampleStripeRefund, stripeRefundStub] = stubStripeRefund(exampleStripeCharge);

            // Non-replanable transaction errors bubble up to the router.
            sinonSandbox.stub(router, "errorHandler")
                .callsFake(err => log.debug("router.errorHandler", err));
            sinonSandbox.stub(insertTransaction, "insertLightrailTransactionSteps")
                .throws(new TransactionPlanError("Error for tests: transaction step insertion error", {isReplanable: false}));

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 500, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);

            if (!testStripeLive()) {
                chai.assert.deepEqual(stripeChargeStub.getCall(0).args[0], {
                    "amount": 400,
                    "currency": request.currency,
                    "metadata": {
                        "lightrailTransactionId": request.id,
                        "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${value4.id}\"}]`,
                        "lightrailUserId": "default-test-user-TEST"
                    },
                    "source": "tok_visa"
                });
                chai.assert.deepEqual(stripeRefundStub.getCall(0).args[0], {
                    amount: 400,
                    charge: exampleStripeCharge.id,
                    metadata: {
                        reason: "Refunded due to error on the Lightrail side."
                    }
                });
            }
        }).timeout(10000);

        it("throws 409 'transaction already exists' if the Lightrail transaction fails for idempotency reasons", async () => {
            sinonSandbox.stub(insertTransaction, "insertTransaction")
                .withArgs(sinon.match.any, sinon.match.any, sinon.match.any)
                .throws(new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId 'TEST-ID-IRRELEVANT' already exists.`, "TransactionExists"));
            const request = {
                ...basicRequest,
                id: generateId()  // needs to be generated for every test so the Stripe refund succeeds (charges use idempotency keys, refunds can't)
            };
            stubNoStripeCharge(request);

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
            chai.assert.equal((postCheckoutResp.body as any).messageCode, "TransactionExists", `messageCode=${(postCheckoutResp.body as any).messageCode}`);
        }).timeout(10000);

        it("handles idempotency errors: fails the repeated transaction but doesn't roll back the original Stripe charge", async function () {
            if (!testStripeLive()) {
                log.warn("Skipping test that currently requires live call to Stripe");
                this.skip();
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
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
            const stripeChargeId = (postCheckoutResp.body.steps.find(steps => steps.rail === "stripe") as StripeTransactionStep).charge.id;
            const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: stripeLiveMerchantConfig.stripeUserId
            });
            chai.assert.equal(stripeCharge.refunded, false, `stripeCharge first GET: check 'refunded': ${JSON.stringify(stripeCharge)}`);
            chai.assert.equal(stripeCharge.amount_refunded, 0, `stripeCharge first GET: check 'amount_refunded': ${JSON.stringify(stripeCharge)}`);

            // post the same charge a third time - if the stripe charge got refunded, this will crash and burn
            const postCheckoutResp3 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp3.statusCode, 409, `body=${JSON.stringify(postCheckoutResp3.body)}`);

            // make sure the original stripe charge still hasn't been affected
            const stripeCharge2 = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: stripeLiveMerchantConfig.stripeUserId
            });
            chai.assert.equal(stripeCharge2.refunded, 0, `stripeCharge second GET: check 'refunded': ${JSON.stringify(stripeCharge)}`);
            chai.assert.equal(stripeCharge2.amount_refunded, false, `stripeCharge second GET: check 'amount_refunded': ${JSON.stringify(stripeCharge)}`);
        }).timeout(10000);
    });

    it("processes split tender checkout with two Stripe sources", async () => {
        // todo - if we keep 'priority' in requested Stripe sources, check that sources are charged in the right order

        const value2: Partial<Value> = {
            id: "value-for-checkout2",
            currency: "CAD",
            balance: 100
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const source2 = "tok_mastercard";
        const request: CheckoutRequest = {
            id: generateId(),
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

        const [exampleStripeResponse1, stub0] = stubCheckoutStripeCharge(request, 1, 100);
        const [exampleStripeResponse2, stub1] = stubCheckoutStripeCharge(request, 2, 300);
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subtotal: 500,
            tax: 0,
            discount: 0,
            discountLightrail: 0,
            payable: 500,
            paidInternal: 0,
            paidLightrail: 100,
            paidStripe: 400,
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
        chai.assert.deepEqualExcluding<any>(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: value2.id,
                code: null,
                contactId: null,
                balanceBefore: 100,
                balanceAfter: 0,
                balanceChange: -100,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
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
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[1], {
            rail: "stripe",
            source: "tok_visa",
            maxAmount: 100,
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[2], {
            rail: "stripe",
            source: "tok_mastercard",
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        if (!testStripeLive()) {
            chai.assert.deepEqual((postCheckoutResp.body.steps[1] as StripeTransactionStep).charge, exampleStripeResponse1);
            chai.assert.deepEqual((postCheckoutResp.body.steps[2] as StripeTransactionStep).charge, exampleStripeResponse2);
            // check that the stub was called with the right arguments, in the right order
            chai.assert.deepEqual(stub0.getCall(0).args[0], {
                "amount": 100,
                "currency": request.currency,
                "metadata": {
                    "lightrailTransactionId": request.id,
                    "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${value2.id}\"},{\"rail\":\"stripe\",\"source\":\"tok_mastercard\"}]`,
                    "lightrailUserId": defaultTestUser.userId
                },
                "source": "tok_visa"
            });
            chai.assert.deepEqual(stub1.getCall(0).args[0], {
                "amount": 300,
                "currency": request.currency,
                "metadata": {
                    "lightrailTransactionId": request.id,
                    "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${value2.id}\"},{\"rail\":\"stripe\",\"source\":\"tok_visa\"}]`,
                    "lightrailUserId": defaultTestUser.userId
                },
                "source": "tok_mastercard"
            });
        }

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value2.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body, null, 4)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    }).timeout(10000);

    describe("respects Stripe minimum charge of $0.50", () => {
        it("fails the transaction by default", async () => {
            const value3: Partial<Value> = {
                id: "value-for-checkout3",
                currency: "CAD",
                balance: 100
            };
            const request: CheckoutRequest = {
                id: generateId(),
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
            stubCheckoutStripeError(request, 1, exampleErrorResponse);

            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value3);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 422, `body=${JSON.stringify(postCheckoutResp.body)}`);

            if (!testStripeLive()) {
                chai.assert.deepEqual((postCheckoutResp.body as any).stripeError, exampleStripeError);
            } else {
                chai.assert.isNotNull((postCheckoutResp.body as any).stripeError);
            }
        });
    });

    it("returns 422 if no customer or source is provided in the rail:stripe source", async () => {
        const request: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "stripe"
                }
            ],
            lineItems: [
                {
                    productId: "socks",
                    unitPrice: 500
                }
            ],
            currency: "CAD"
        };

        const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(checkout.statusCode, 422);
    });

    if (!testStripeLive()) {
        it("returns 403 on StripePermissionError", async () => {
            const request: CheckoutRequest = {
                id: generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ],
                lineItems: [
                    {
                        productId: "socks",
                        unitPrice: 500
                    }
                ],
                currency: "CAD"
            };
            const exampleStripeError = {
                "type": "StripePermissionError",
                "stack": "Error: Only Stripe Connect platforms can work with other accounts. If you specified a client_id parameter, make sure it's correct. If you need to setup a Stripe Connect platform, you can do so at https://dashboard.stripe.com/account/applications/settings.\n    at Constructor._Error (/Users/timothyjordison/Documents/work/repos/lightrail/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/timothyjordison/Documents/work/repos/lightrail/internal-rothschild/node_modules/stripe/lib/utils.js:134:13)\n    at new Constructor (/Users/timothyjordison/Documents/work/repos/lightrail/internal-rothschild/node_modules/stripe/lib/utils.js:134:13)\n    at IncomingMessage.<anonymous> (/Users/timothyjordison/Documents/work/repos/lightrail/internal-rothschild/node_modules/stripe/lib/StripeResource.js:151:21)\n    at emitNone (events.js:111:20)\n    at IncomingMessage.emit (events.js:208:7)\n    at endReadableNT (_stream_readable.js:1055:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
                "rawType": "invalid_request_error",
                "message": "Only Stripe Connect platforms can work with other accounts. If you specified a client_id parameter, make sure it's correct. If you need to setup a Stripe Connect platform, you can do so at https://dashboard.stripe.com/account/applications/settings.",
                "raw": {
                    "message": "Only Stripe Connect platforms can work with other accounts. If you specified a client_id parameter, make sure it's correct. If you need to setup a Stripe Connect platform, you can do so at https://dashboard.stripe.com/account/applications/settings.",
                    "type": "invalid_request_error",
                    "headers": {
                        "server": "nginx",
                        "date": "Mon, 14 Jan 2019 19:45:23 GMT",
                        "content-type": "application/json",
                        "content-length": "324",
                        "connection": "close",
                        "access-control-allow-credentials": "true",
                        "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                        "access-control-allow-origin": "*",
                        "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                        "access-control-max-age": "300",
                        "cache-control": "no-cache, no-store",
                        "stripe-version": "2018-05-21",
                        "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                    },
                    "statusCode": 403
                },
                "headers": {
                    "server": "nginx",
                    "date": "Mon, 14 Jan 2019 19:45:23 GMT",
                    "content-type": "application/json",
                    "content-length": "324",
                    "connection": "close",
                    "access-control-allow-credentials": "true",
                    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                    "access-control-allow-origin": "*",
                    "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                    "access-control-max-age": "300",
                    "cache-control": "no-cache, no-store",
                    "stripe-version": "2018-05-21",
                    "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                },
                "statusCode": 403
            };
            const exampleErrorResponse = new StripeRestError(424
                , "Error for tests", null, exampleStripeError);
            stubCheckoutStripeError(request, 0, exampleErrorResponse);

            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(checkout.statusCode, 424);
        });

        it("returns 429 on Stripe RateLimitError", async () => {
            const request: CheckoutRequest = {
                id: generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ],
                lineItems: [
                    {
                        productId: "socks",
                        unitPrice: 500
                    }
                ],
                currency: "CAD"
            };
            // Mocked error since I couldn't produce a real 429 error from stripe. This test doesn't run in live so it doesn't matter.
            const exampleStripeError = {
                "type": "RateLimitError",
                "stack": "Mock",
                "rawType": "Mock",
                "message": "Mock - too many requests.",
                "raw": {
                    "message": "Mock.",
                    "type": "invalid_request_error",
                    "statusCode": 429
                },
                "headers": {},
                "statusCode": 429
            };
            const exampleErrorResponse = new StripeRestError(429
                , "Error for tests", null, exampleStripeError);
            stubCheckoutStripeError(request, 0, exampleErrorResponse);

            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(checkout.statusCode, 429);
        });
    }

    if (testStripeLive()) {
        describe("stripe customer + source tests", () => {
            it("can charge a customer's default card", async () => {
                const request: CheckoutRequest = {
                    id: generateId(),
                    allowRemainder: true,
                    sources: [
                        {
                            rail: "stripe",
                            customer: "cus_CP4Zd1Dddy4cOH"
                        }
                    ],
                    lineItems: [
                        {
                            productId: "socks",
                            unitPrice: 500
                        }
                    ],
                    currency: "CAD"
                };

                chai.assert.equal(request.sources[0]["customer"], "cus_CP4Zd1Dddy4cOH", "Specific customer id in integrationtesting+merchant@giftbit.com. If changed test will fail");
                const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
                chai.assert.equal(checkout.statusCode, 201);
                chai.assert.equal(checkout.body.steps[0]["amount"], -500);
                chai.assert.equal(checkout.body.steps[0]["charge"]["source"]["id"], "card_1C0GSUCM9MOvFvZK8VB29qaz", "This is the customer's (cus_CP4Zd1Dddy4cOH in integrationtesting+merchant@giftbit.com) default card in. It should have been automatically charged.");
            }).timeout(10000);

            it("can charge a customer's non-default card", async () => {
                const request: CheckoutRequest = {
                    id: generateId(),
                    allowRemainder: true,
                    sources: [
                        {
                            rail: "stripe",
                            customer: "cus_CP4Zd1Dddy4cOH",
                            source: "card_1C0ZH9CM9MOvFvZKyZZc2X4Z"
                        }
                    ],
                    lineItems: [
                        {
                            productId: "socks",
                            unitPrice: 500
                        }
                    ],
                    currency: "CAD"
                };

                chai.assert.equal(request.sources[0]["customer"], "cus_CP4Zd1Dddy4cOH", "Specific customer id in integrationtesting+merchant@giftbit.com. If changed test will fail");
                chai.assert.equal(request.sources[0]["source"], "card_1C0ZH9CM9MOvFvZKyZZc2X4Z", "Specific card id in integrationtesting+merchant@giftbit.com attached to customer. If changed test will fail");
                const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
                chai.assert.equal(checkout.statusCode, 201);
                chai.assert.equal(checkout.body.steps[0]["amount"], -500);
                chai.assert.equal(checkout.body.steps[0]["charge"]["source"]["id"], "card_1C0ZH9CM9MOvFvZKyZZc2X4Z");
            }).timeout(10000);
        });
    }
});

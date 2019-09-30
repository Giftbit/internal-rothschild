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
    setStubbedStripeUserId,
    setStubsForStripeTests,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {
    createCharge,
    createCustomer,
    createCustomerSource,
    retrieveCharge
} from "../../../../utils/stripeUtils/stripeTransactions";
import chaiExclude from "chai-exclude";
import {TestUser} from "../../../../utils/testUtils/TestUser";
import log = require("loglevel");
import Stripe = require("stripe");
import ICharge = Stripe.charges.ICharge;

chai.use(chaiExclude);

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

    before(async () => {
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

        await setStubsForStripeTests();
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
            remainder: 0,
            forgiven: 0
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

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `GET body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it("processes basic checkout with Stripe only - `customer` as payment source", async () => {
        const customer = await createCustomer({source: "tok_visa"}, true, defaultTestUser.stripeAccountId);

        const request: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "stripe",
                    customer: customer.id
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
            discountLightrail: 0,
            payable: 123,
            paidInternal: 0,
            paidLightrail: 0,
            paidStripe: 123,
            remainder: 0,
            forgiven: 0
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
            customer: customer.id,
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

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
            remainder: 0,
            forgiven: 0
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

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${basicRequest.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

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
            remainder: 0,
            forgiven: 0
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

    it("posts the LR transaction identifier as metadata on the Stripe charge", async () => {
        const lrCheckoutTransaction = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${basicRequest.id}`, "GET");  // created in first split tender test
        chai.assert.equal(lrCheckoutTransaction.statusCode, 200);

        const stripeChargeId = (lrCheckoutTransaction.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).charge.id;
        const stripeCharge = await retrieveCharge(stripeChargeId, true, defaultTestUser.stripeAccountId);

        chai.assert.deepEqual(stripeCharge.metadata, {
            lightrailTransactionId: basicRequest.id,
            "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${value.id}\"}]`,
            "lightrailUserId": defaultTestUser.userId
        });
    });

    it("writes metadata to both LR & Stripe transactions", async () => {
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

        chai.assert.deepEqual(stripeStep.charge.metadata, {
            ...request.metadata,
            lightrailTransactionId: request.id,
            lightrailTransactionSources: "[]",
            lightrailUserId: defaultTestUser.userId
        });

        const stripeChargeId = (postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).chargeId;
        const stripeCharge = await retrieveCharge(stripeChargeId, true, defaultTestUser.stripeAccountId);
        chai.assert.deepEqual(stripeCharge.metadata, stripeStep.charge.metadata);
    });

    it("passes additionalStripeParams to Stripe", async () => {
        const onBehalfOf = testStripeLive() ? null : defaultTestUser.stripeAccountId;
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

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);

        const stripeStep = postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep;
        chai.assert.isObject(stripeStep, "found stripe step");

        const stripeCharge = stripeStep.charge as ICharge;
        chai.assert.equal(stripeCharge.description, "eee");
        chai.assert.equal(stripeCharge.on_behalf_of, onBehalfOf);
        chai.assert.equal(stripeCharge.receipt_email, "bbb@example.com");
        chai.assert.equal(stripeCharge.statement_descriptor, "ccc");
        chai.assert.equal(stripeCharge.transfer_group, "ddd");
        chai.assert.deepEqual(stripeCharge.shipping, {
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
        }, `stripeCharge.shipping=${JSON.stringify(stripeCharge.shipping)}`);

        const stripeChargeId = (postCheckoutResp.body.steps.find(step => step.rail === "stripe") as StripeTransactionStep).chargeId;
        const stripeChargeRetrieved = await retrieveCharge(stripeChargeId, true, defaultTestUser.stripeAccountId);
        chai.assert.deepEqual(stripeChargeRetrieved.metadata, stripeCharge.metadata);
    });

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
            remainder: 0,
            forgiven: 0
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
            // This test relies upon Stripe transaction steps using <transactionId>-<stepIx>
            // as the Stripe idempotency key to generate a conflict.
            const idempotencyKey = generateId();

            const firstRequest = {
                amount: 55,
                currency: "CAD",
                source: "tok_visa"
            };
            await createCharge(firstRequest, true, defaultTestUser.stripeAccountId, `${idempotencyKey}-0`);

            const request = {
                ...basicRequest,
                id: idempotencyKey
            };
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
        });

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
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 500, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
        });

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

            // Non-replanable transaction errors bubble up to the router.
            sinonSandbox.stub(router, "errorHandler")
                .callsFake(err => log.debug("router.errorHandler", err));
            sinonSandbox.stub(insertTransaction, "insertLightrailTransactionSteps")
                .throws(new TransactionPlanError("Error for tests: transaction step insertion error", {isReplanable: false}));

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 500, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
        });

        it("throws 409 'transaction already exists' if the Lightrail transaction fails for idempotency reasons", async () => {
            sinonSandbox.stub(insertTransaction, "insertTransaction")
                .withArgs(sinon.match.any, sinon.match.any, sinon.match.any)
                .throws(new giftbitRoutes.GiftbitRestError(409, `A transaction with transactionId 'TEST-ID-IRRELEVANT' already exists.`, "TransactionExists"));
            const request = {
                ...basicRequest,
                id: generateId()  // needs to be generated for every test so the Stripe refund succeeds (charges use idempotency keys, refunds can't)
            };

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body, null, 4)}`);
            chai.assert.equal((postCheckoutResp.body as any).messageCode, "TransactionExists", `messageCode=${(postCheckoutResp.body as any).messageCode}`);
        });

        it("handles idempotency errors: fails the repeated transaction but doesn't roll back the original Stripe charge", async function () {
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
            const stripeChargeId = (postCheckoutResp.body.steps.find(steps => steps.rail === "stripe") as StripeTransactionStep).charge.id;
            const stripeCharge = await retrieveCharge(stripeChargeId, true, defaultTestUser.stripeAccountId);
            chai.assert.equal(stripeCharge.refunded, false, `stripeCharge first GET: check 'refunded': ${JSON.stringify(stripeCharge)}`);
            chai.assert.equal(stripeCharge.amount_refunded, 0, `stripeCharge first GET: check 'amount_refunded': ${JSON.stringify(stripeCharge)}`);

            // post the same charge a third time - if the stripe charge got refunded, this will crash and burn
            const postCheckoutResp3 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(postCheckoutResp3.statusCode, 409, `body=${JSON.stringify(postCheckoutResp3.body)}`);

            // make sure the original stripe charge still hasn't been affected
            const stripeCharge2 = await retrieveCharge(stripeChargeId, true, defaultTestUser.stripeAccountId);
            chai.assert.equal(stripeCharge2.refunded, false, `stripeCharge second GET: check 'refunded': ${JSON.stringify(stripeCharge)}`);
            chai.assert.equal(stripeCharge2.amount_refunded, 0, `stripeCharge second GET: check 'amount_refunded': ${JSON.stringify(stripeCharge)}`);
        });
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
            remainder: 0,
            forgiven: 0
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

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value2.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body, null, 4)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body, `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it("throws a 502 if Stripe throws a 500", async function () {
        if (testStripeLive()) {
            // This test relies upon a special token not implemented in the official server.
            this.skip();
        }

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "stripe",
                    source: "tok_500",
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 2000
                }
            ],
            currency: "CAD"
        };

        const checkoutResponse = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResponse.statusCode, 502);
    });

    describe("handling Stripe minimum charge of $0.50", () => {
        it("fails for Stripe charges below the default minimum", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: source,
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 49
                    }
                ],
                currency: "CAD"
            };

            const postSimulateCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                ...checkoutRequest,
                simulate: true
            });
            chai.assert.equal(postSimulateCheckoutResp.statusCode, 409, `body=${JSON.stringify(postSimulateCheckoutResp.body)}`);

            const postCheckoutResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body)}`);
            chai.assert.equal(postCheckoutResp.body.messageCode, "StripeAmountTooSmall");
        });

        it("accepts Stripe charges at the minimum", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: source,
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

            const postSimulateCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                ...checkoutRequest,
                simulate: true
            });
            chai.assert.equal(postSimulateCheckoutResp.statusCode, 200, `body=${JSON.stringify(postSimulateCheckoutResp.body)}`);

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        });

        it("can be configured to forgive the charge amount", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 100
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: source,
                        forgiveSubMinAmount: true
                    }
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

            const postSimulateCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                ...checkoutRequest,
                simulate: true
            });
            chai.assert.equal(postSimulateCheckoutResp.statusCode, 200, `body=${JSON.stringify(postSimulateCheckoutResp.body)}`);
            chai.assert.deepEqual(postSimulateCheckoutResp.body.totals, {
                discount: 0,
                discountLightrail: 0,
                forgiven: 25,
                paidInternal: 0,
                paidLightrail: 100,
                paidStripe: 0,
                payable: 125,
                remainder: 0,
                subtotal: 125,
                tax: 0
            });
            chai.assert.lengthOf(postSimulateCheckoutResp.body.steps, 1);
            chai.assert.equal(postSimulateCheckoutResp.body.steps[0].rail, "lightrail");

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
            chai.assert.deepEqual(postCheckoutResp.body.totals, {
                discount: 0,
                discountLightrail: 0,
                forgiven: 25,
                paidInternal: 0,
                paidLightrail: 100,
                paidStripe: 0,
                payable: 125,
                remainder: 0,
                subtotal: 125,
                tax: 0
            });
            chai.assert.lengthOf(postCheckoutResp.body.steps, 1);
            chai.assert.equal(postCheckoutResp.body.steps[0].rail, "lightrail");
        });

        it("gives prescedence to allowRemainder=true over forgiveMinChange=true", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 100
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: source,
                        forgiveSubMinAmount: true
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 125
                    }
                ],
                currency: "CAD",
                allowRemainder: true
            };

            const postSimulateCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                ...checkoutRequest,
                simulate: true
            });
            chai.assert.equal(postSimulateCheckoutResp.statusCode, 200, `body=${JSON.stringify(postSimulateCheckoutResp.body)}`);
            chai.assert.deepEqual(postSimulateCheckoutResp.body.totals, {
                discount: 0,
                discountLightrail: 0,
                forgiven: 0,
                paidInternal: 0,
                paidLightrail: 100,
                paidStripe: 0,
                payable: 125,
                remainder: 25,
                subtotal: 125,
                tax: 0
            });
            chai.assert.lengthOf(postSimulateCheckoutResp.body.steps, 1);
            chai.assert.equal(postSimulateCheckoutResp.body.steps[0].rail, "lightrail");

            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
            chai.assert.deepEqual(postCheckoutResp.body.totals, {
                discount: 0,
                discountLightrail: 0,
                forgiven: 0,
                paidInternal: 0,
                paidLightrail: 100,
                paidStripe: 0,
                payable: 125,
                remainder: 25,
                subtotal: 125,
                tax: 0
            });
            chai.assert.lengthOf(postCheckoutResp.body.steps, 1);
            chai.assert.equal(postCheckoutResp.body.steps[0].rail, "lightrail");
        });

        it("can be configured for a lower minAmount (which Stripe may actually accept depending upon the settlement currency)", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "stripe",
                        source: source,
                        minAmount: 48
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 49
                    }
                ],
                currency: "CAD"
            };

            const postSimulateCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                ...checkoutRequest,
                simulate: true
            });
            chai.assert.equal(postSimulateCheckoutResp.statusCode, 200, `body=${JSON.stringify(postSimulateCheckoutResp.body)}`);
            chai.assert.lengthOf(postSimulateCheckoutResp.body.steps, 1);
            chai.assert.equal(postSimulateCheckoutResp.body.steps[0].rail, "stripe");
            chai.assert.equal((postSimulateCheckoutResp.body.steps[0] as StripeTransactionStep).amount, -49);

            // Not sent to Stripe because it will treat CAD as the settlement currency so $0.50 min is actually correct.
        });

        it("returns 409 for simulate=false transactions where minAmount is lower than Stripe will accept", async function () {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "stripe",
                        source: source,
                        minAmount: 48
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 49
                    }
                ],
                currency: "CAD"
            };

            const postCheckoutResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body)}`);
            chai.assert.equal(postCheckoutResp.body.messageCode, "StripeAmountTooSmall");
        });

        it("can be configured for a higher minAmount", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "stripe",
                        source: source,
                        minAmount: 200
                    }
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

            const postSimulateCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                ...checkoutRequest,
                simulate: true
            });
            chai.assert.equal(postSimulateCheckoutResp.statusCode, 409, `body=${JSON.stringify(postSimulateCheckoutResp.body)}`);

            const postCheckoutResp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(postCheckoutResp.statusCode, 409, `body=${JSON.stringify(postCheckoutResp.body)}`);
            chai.assert.equal(postCheckoutResp.body.messageCode, "StripeAmountTooSmall");
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

    it("returns 424 on StripePermissionError", async () => {
        // Create a new TestUser but don't create the Stripe account.  This Stripe
        // account will be invalid both in test and live.
        const testUser = new TestUser();
        setStubbedStripeUserId(testUser, "acct_invalid");

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

        const checkout = await testUser.request<any>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(checkout.statusCode, 424);
    });

    it("returns 429 on Stripe RateLimitError (mock server only)", async function () {
        if (testStripeLive()) {
            // This test uses a special token only implemented in the mock server.
            this.skip();
        }

        const request: CheckoutRequest = {
            id: generateId(),
            allowRemainder: true,
            sources: [
                {
                    rail: "stripe",
                    source: "tok_429"
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
        chai.assert.equal(checkout.statusCode, 429);
    });

    describe("stripe customer + source tests", () => {
        it("can charge a customer's default card", async () => {
            const customer = await createCustomer({source: "tok_visa"}, true, defaultTestUser.stripeAccountId);

            const request: CheckoutRequest = {
                id: generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "stripe",
                        customer: customer.id
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

            chai.assert.equal(request.sources[0]["customer"], customer.id);
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(checkout.statusCode, 201);
            chai.assert.equal(checkout.body.steps[0]["amount"], -500);
            chai.assert.equal(checkout.body.steps[0]["charge"]["source"]["id"], customer.default_source);
        });

        it("can charge a customer's non-default card", async () => {
            const customer = await createCustomer({source: "tok_visa"}, true, defaultTestUser.stripeAccountId);
            const source = await createCustomerSource(customer.id, {source: "tok_mastercard"}, true, defaultTestUser.stripeAccountId);
            chai.assert.notEqual(source.id, customer.default_source, "newly created source is not default source");

            const request: CheckoutRequest = {
                id: generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "stripe",
                        customer: customer.id,
                        source: source.id
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

            chai.assert.equal(request.sources[0]["customer"], customer.id);
            chai.assert.equal(request.sources[0]["source"], source.id);
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(checkout.statusCode, 201);
            chai.assert.equal(checkout.body.steps[0]["amount"], -500);
            chai.assert.equal(checkout.body.steps[0]["charge"]["source"]["id"], source.id);
        });
    });
}).timeout(10000);

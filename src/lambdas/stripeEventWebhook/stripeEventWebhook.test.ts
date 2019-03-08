// create charge (connected account)
// refund - normal
// update refund -- fraudulent

// create charge (elevated risk)
// refund - normal

// ====================================
// Handling Stripe refunds with elevated risk level:
//     There are three levels of risk evaluation: normal, elevated, high. High risk transactions are blocked by default. Elevated risk transactions succeed, but if they are using Stripe Radar for Fraud Teams, it will be placed in a queue for manual review.
//     Should this endpoint listen for:
// - Any refunds (any reason) where the original charge event had `risk_level: elevated`?
//     - Refunds for any charge with `reason: fraudulent`?
//
//     `charge.refunded` (use `charge.refunds.data[##].reason == 'fraudulent'`)
//         `charge.refund.updated` - Occurs whenever a refund is updated, on selected payment methods.
//     `review.closed` - Occurs whenever a review is closed. The review’s reason field indicates why: approved, disputed, refunded, or refunded_as_fraud
// ====================================


import * as cassava from "cassava";
import * as cryptojs from "crypto-js";
import * as testUtils from "../../utils/testUtils";
import {generateId, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    generateStripeChargeResponse,
    generateStripeRefundResponse,
    setStubsForStripeTests,
    stripeLiveLightrailConfig,
    stripeLiveMerchantConfig,
    stubCheckoutStripeCharge,
    stubStripeRefund,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {createCurrency} from "../rest/currencies";
import {Currency} from "../../model/Currency";
import {stripeApiVersion} from "../../utils/stripeUtils/StripeConfig";
import {CheckoutRequest} from "../../model/TransactionRequest";
import * as stripe from "stripe";
import {createRefund} from "../../utils/stripeUtils/stripeTransactions";

describe("/v2/stripeEventWebhook", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    const currency: Currency = {
        code: "CAD",
        name: "Antlers",
        symbol: "$",
        decimalPlaces: 2
    };
    const value1: Partial<Value> = {
        id: generateId(),
        currency: "CAD",
        balance: 50 // deliberately low so Stripe will always be charged
    };

    const checkoutReqBase: CheckoutRequest = {
        id: "",
        currency: currency.code,
        lineItems: [{
            type: "product",
            productId: "pid",
            unitPrice: 1000
        }],
        sources: [
            {
                rail: "lightrail",
                valueId: value1.id
            },
            {
                rail: "stripe",
                source: "tok_visa"
            }
        ]
    };

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        await createCurrency(testUtils.defaultTestUser.auth, currency);

        const postValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value1);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("verifies event signatures", async () => {
        const webhookResp0 = await cassava.testing.testRouter(webhookEventRouter, cassava.testing.createTestProxyEvent("/v2/stripeEventWebhook", "POST", {body: JSON.stringify({food: "bard"})}));
        chai.assert.equal(webhookResp0.statusCode, 401);

        const webhookResp1 = await testSignedWebhookRequest(webhookEventRouter, {});
        chai.assert.equal(webhookResp1.statusCode, 204);
        const webhookResp2 = await testSignedWebhookRequest(webhookEventRouter, {foo: "bar"});
        chai.assert.equal(webhookResp2.statusCode, 204);
        const webhookResp3 = await testSignedWebhookRequest(webhookEventRouter, {
            foo: "bar",
            baz: [1, null, "2", undefined, {three: 0.4}]
        });
        chai.assert.equal(webhookResp3.statusCode, 204);
    });

    it("does nothing for vanilla refunds", async () => {
        const checkoutRequest: CheckoutRequest = {
            ...checkoutReqBase,
            id: generateId()
        };
        const [stripeResponse] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);
        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        if (!testStripeLive()) {
            chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeResponse.id);
            chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeResponse, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
        }

        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", stripeStep.charge));
        chai.assert.equal(webhookResp.statusCode, 204);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200);
        chai.assert.equal(fetchValueResp.body.balance, 0);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.body.length, 1);
    });

    it("reverses Lightrail transaction & freezes Values for Stripe refunds created with 'reason: fraudulent'", async () => {
        // Setup: create Value and Checkout transaction
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 50
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: currency.code,
            lineItems: [{
                type: "product",
                productId: "pid",
                unitPrice: 1000
            }],
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ]
        };
        const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        if (!testStripeLive()) { // check that the stubbing is doing what it should
            chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
            chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
        }

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        // Create the refund in Stripe with 'reason: fraudulent' that will trigger a webhook event being posted
        let refundedCharge: stripe.charges.ICharge;
        if (testStripeLive()) {
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

            // if live testing, need to make sure the charge actually exists in Stripe
            const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            chai.assert.isNotNull(chargeFromStripe);

            refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        } else {
            stubStripeRefund(stripeStep.charge as stripe.charges.ICharge, {reason: "fraudulent"});
            refundedCharge = {
                ...stripeCheckoutChargeMock,
                refunded: true,
                refunds: {
                    object: "list",
                    data: [
                        generateStripeRefundResponse({
                            amount: stripeCheckoutChargeMock.amount,
                            currency: stripeCheckoutChargeMock.currency,
                            reason: "fraudulent",
                            stripeChargeId: stripeCheckoutChargeMock.id
                        })
                    ],
                    has_more: false,
                    url: null
                }
            };
        }

        // Create & post webhook event locally (live events DO get triggered during live testing,
        // but we can't use them because they get posted to the lamdba, not sent back in an http response)
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204);

        // Check that transaction chain & values are in the expected state
        // NOTE if we ever start returning responses before handling the event we might need to address timing here - see https://stripe.com/docs/webhooks#best-practices
        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance);
        chai.assert.equal(fetchValueResp.body.frozen, true);
    }).timeout(8000);

    it("does nothing if event comes from our account instead of Connected account", async () => {
        const platformWebhookEvent = generateConnectWebhookEventMock("nonsense.event.type", generateStripeChargeResponse({
            transactionId: generateId(),
            amount: 1234,
            currency: "NIL",
            pending: false,
        }));
        delete platformWebhookEvent.account;

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, platformWebhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204);
    });

    it("logs Stripe eventId & Connected accountId in metadata", async () => {
        // Setup: create Value and Checkout transaction
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 50
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: currency.code,
            lineItems: [{
                type: "product",
                productId: "pid",
                unitPrice: 1000
            }],
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ]
        };
        const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        if (!testStripeLive()) { // check that the stubbing is doing what it should
            chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
            chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
        }

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        // Create the refund in Stripe with 'reason: fraudulent' that will trigger a webhook event being posted
        let refundedCharge: stripe.charges.ICharge;
        if (testStripeLive()) {
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

            // if live testing, need to make sure the charge actually exists in Stripe
            const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            chai.assert.isNotNull(chargeFromStripe);

            refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        } else {
            stubStripeRefund(stripeStep.charge as stripe.charges.ICharge, {reason: "fraudulent"});
            refundedCharge = {
                ...stripeCheckoutChargeMock,
                refunded: true,
                refunds: {
                    object: "list",
                    data: [
                        generateStripeRefundResponse({
                            amount: stripeCheckoutChargeMock.amount,
                            currency: stripeCheckoutChargeMock.currency,
                            reason: "fraudulent",
                            stripeChargeId: stripeCheckoutChargeMock.id
                        })
                    ],
                    has_more: false,
                    url: null
                }
            };
        }

        // Create & post webhook event locally (live events DO get triggered during live testing,
        // but we can't use them because they get posted to the lamdba, not sent back in an http response)
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedCharge);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204);

        // Check that transaction chain & values are in the expected state
        // NOTE if we ever start returning responses before handling the event we might need to address timing here - see https://stripe.com/docs/webhooks#best-practices
        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const reverseTransaction: Transaction = fetchTransactionChainResp.body[1];
        chai.assert.deepEqual(reverseTransaction.metadata, {stripeWebhookTriggeredAction: `Transaction reversed by Lightrail because Stripe charge ${refundedCharge.id} was refunded as fraudulent. Stripe eventId: ${webhookEvent.id}, Stripe accountId: ${stripeLiveMerchantConfig.stripeUserId}`}, `reverseTransaction metadata: ${JSON.stringify(reverseTransaction.metadata)}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        chai.assert.deepEqual(fetchValueResp.body.metadata, {stripeWebhookTriggeredAction: `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${checkoutRequest.id}' with reverse transaction '${reverseTransaction.id}', Stripe chargeId: '${refundedCharge.id}', Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `value metadata: ${JSON.stringify(fetchValueResp.body.metadata)}`);
    }).timeout(8000);

    describe("handles scenarios - action already taken in Lightrail", () => {
        it("Lightrail transaction already reversed", async () => {
            // Setup: create Value and Checkout transaction
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50
            };
            const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
            chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: currency.code,
                lineItems: [{
                    type: "product",
                    productId: "pid",
                    unitPrice: 1000
                }],
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ]
            };
            const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
            if (!testStripeLive()) { // check that the stubbing is doing what it should
                chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
                chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
            }

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

            // Setup: reverse transaction through Lightrail
            let refundedCharge: stripe.charges.ICharge; // = <stripe.charges.ICharge>stripeReversalStep.charge;

            // If mocking Stripe, need to set up stub before calling the method
            if (!testStripeLive()) {
                stubStripeRefund(stripeChargeStep.charge as stripe.charges.ICharge, {reason: "fraudulent"});
                refundedCharge = {
                    ...stripeCheckoutChargeMock,
                    refunded: true,
                    refunds: {
                        object: "list",
                        data: [
                            generateStripeRefundResponse({
                                amount: stripeCheckoutChargeMock.amount,
                                currency: stripeCheckoutChargeMock.currency,
                                reason: "fraudulent",
                                stripeChargeId: stripeCheckoutChargeMock.id
                            })
                        ],
                        has_more: false,
                        url: null
                    }
                };
            }

            // Reverse transaction through Lightrail
            const reversedTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: generateId()});
            chai.assert.equal(reversedTransactionResponse.statusCode, 201, `reversedTransactionResponse.body=${JSON.stringify(reversedTransactionResponse)}`);
            chai.assert.isNotNull(reversedTransactionResponse.body.steps.find(step => step.rail === "stripe"));

            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

                // if live testing, need to make sure the charge and refund actually exist in Stripe
                const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
                chai.assert.isNotNull(chargeFromStripe);
                chai.assert.equal(chargeFromStripe.refunds.data.length, 1);

                // Manual workaround: update refund on returned charge with 'reason: fraudulent' so the webhook safety checks will pass
                // Normal flow for a transaction reversed in Lightrail would be to do this through the Stripe dashboard
                refundedCharge = {...chargeFromStripe};
                refundedCharge.refunds.data[0].reason = "fraudulent";
            }

            // Create & post webhook event locally (live events DO get triggered during live testing,
            // but we can't use them because they get posted to the lamdba, not sent back in an http response)
            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
            chai.assert.equal(webhookResp.statusCode, 204);

            // Check that transaction chain & values are as expected
            // Transaction chain already had 'reverse'
            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2);
            chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            // Value was not frozen before, should be now
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true);
        }).timeout(8000);

        it("Lightrail transaction already reversed and Values already frozen", async () => {
            // Setup: create Value and Checkout transaction
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50
            };
            const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
            chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: currency.code,
                lineItems: [{
                    type: "product",
                    productId: "pid",
                    unitPrice: 1000
                }],
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ]
            };
            const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
            if (!testStripeLive()) { // check that the stubbing is doing what it should
                chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
                chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
            }

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

            // Setup: reverse transaction through Lightrail
            let refundedCharge: stripe.charges.ICharge; // = <stripe.charges.ICharge>stripeReversalStep.charge;

            // If mocking Stripe, need to set up stub before calling the method
            if (!testStripeLive()) {
                stubStripeRefund(stripeChargeStep.charge as stripe.charges.ICharge, {reason: "fraudulent"});
                refundedCharge = {
                    ...stripeCheckoutChargeMock,
                    refunded: true,
                    refunds: {
                        object: "list",
                        data: [
                            generateStripeRefundResponse({
                                amount: stripeCheckoutChargeMock.amount,
                                currency: stripeCheckoutChargeMock.currency,
                                reason: "fraudulent",
                                stripeChargeId: stripeCheckoutChargeMock.id
                            })
                        ],
                        has_more: false,
                        url: null
                    }
                };
            }

            // Reverse transaction through Lightrail
            const reversedTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: generateId()});
            chai.assert.equal(reversedTransactionResponse.statusCode, 201, `reversedTransactionResponse.body=${JSON.stringify(reversedTransactionResponse)}`);
            chai.assert.isNotNull(reversedTransactionResponse.body.steps.find(step => step.rail === "stripe"));

            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

                // if live testing, need to make sure the charge and refund actually exist in Stripe
                const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
                chai.assert.isNotNull(chargeFromStripe);
                chai.assert.equal(chargeFromStripe.refunds.data.length, 1);

                // Manual workaround: update refund on returned charge with 'reason: fraudulent' so the webhook safety checks will pass
                // Normal flow for a transaction reversed in Lightrail would be to do this through the Stripe dashboard
                refundedCharge = {...chargeFromStripe};
                refundedCharge.refunds.data[0].reason = "fraudulent";
            }

            // Freeze Value
            const freezeValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "PATCH", {frozen: true});
            chai.assert.equal(freezeValueResp.statusCode, 200);
            chai.assert.equal(freezeValueResp.body.frozen, true);

            // Create & post webhook event locally (live events DO get triggered during live testing,
            // but we can't use them because they get posted to the lamdba, not sent back in an http response)
            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
            chai.assert.equal(webhookResp.statusCode, 204);

            // Check that transaction chain & values are as expected
            // Transaction chain already had 'reverse'
            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2);
            chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            // Value should still be frozen
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true);
        }).timeout(8000);

        it("Lightrail transaction not reversed but Values frozen");
    });

    describe("handles scenarios - irreversible Transaction", () => {
        it("uses existing 'reverse' Transaction", async () => {
            // Setup: create Value and Checkout transaction
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50
            };
            const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
            chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: currency.code,
                lineItems: [{
                    type: "product",
                    productId: "pid",
                    unitPrice: 1000
                }],
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ]
            };
            const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
            if (!testStripeLive()) { // check that the stubbing is doing what it should
                chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
                chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
            }

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

            // Setup: for reversing transaction through Lightrail
            let refundedCharge: stripe.charges.ICharge;

            // If mocking Stripe, need to set stub before calling the method
            if (!testStripeLive()) {
                stubStripeRefund(stripeChargeStep.charge as stripe.charges.ICharge, {reason: "fraudulent"});
                refundedCharge = {
                    ...stripeCheckoutChargeMock,
                    refunded: true,
                    refunds: {
                        object: "list",
                        data: [
                            generateStripeRefundResponse({
                                amount: stripeCheckoutChargeMock.amount,
                                currency: stripeCheckoutChargeMock.currency,
                                reason: "fraudulent",
                                stripeChargeId: stripeCheckoutChargeMock.id
                            })
                        ],
                        has_more: false,
                        url: null
                    }
                };
            }

            // Reverse transaction through Lightrail
            const reversedTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: generateId()});
            chai.assert.equal(reversedTransactionResponse.statusCode, 201, `reversedTransactionResponse.body=${JSON.stringify(reversedTransactionResponse)}`);
            chai.assert.isNotNull(reversedTransactionResponse.body.steps.find(step => step.rail === "stripe"));

            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

                // if live testing, need to make sure the charge and refund actually exist in Stripe
                const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
                chai.assert.isNotNull(chargeFromStripe);
                chai.assert.equal(chargeFromStripe.refunds.data.length, 1);

                // Manual workaround: update refund on returned charge with 'reason: fraudulent' so the webhook safety checks will pass
                // Normal flow for a transaction reversed in Lightrail would be to do this through the Stripe dashboard
                refundedCharge = {...chargeFromStripe};
                refundedCharge.refunds.data[0].reason = "fraudulent";
            }

            // Create & post webhook event locally (live events DO get triggered during live testing,
            // but we can't use them because they get posted to the lamdba, not sent back in an http response)
            const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedCharge);
            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
            chai.assert.equal(webhookResp.statusCode, 204);

            // Check that transaction chain & values are as expected
            // Transaction chain already had 'reverse'
            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2);
            chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            // Value was not frozen before, should be now
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
            chai.assert.deepEqual(fetchValueResp.body.metadata, {stripeWebhookTriggeredAction: `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${checkoutRequest.id}' with reverse transaction '${reversedTransactionResponse.body.id}', Stripe chargeId: '${refundedCharge.id}', Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `value metadata: ${JSON.stringify(fetchValueResp.body.metadata)}`);
        }).timeout(8000);

        it("voids instead of reversing if original Transaction was pending", async () => {
            // Setup: create Value and Checkout transaction
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50
            };
            const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
            chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: currency.code,
                lineItems: [{
                    type: "product",
                    productId: "pid",
                    unitPrice: 1000
                }],
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ],
                pending: true
            };
            const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
            if (!testStripeLive()) { // check that the stubbing is doing what it should
                chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
                chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
            }

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");
            chai.assert.equal((stripeStep.charge as stripe.charges.ICharge).captured, false);

            // Create the refund in Stripe with 'reason: fraudulent' that will trigger a webhook event being posted
            let refundedCharge: stripe.charges.ICharge;
            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

                // if live testing, need to make sure the charge actually exists in Stripe
                const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
                chai.assert.isNotNull(chargeFromStripe);

                refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

            } else {
                stubStripeRefund(stripeStep.charge as stripe.charges.ICharge, {reason: "fraudulent"});
                refundedCharge = {
                    ...stripeCheckoutChargeMock,
                    refunded: true,
                    refunds: {
                        object: "list",
                        data: [
                            generateStripeRefundResponse({
                                amount: stripeCheckoutChargeMock.amount,
                                currency: stripeCheckoutChargeMock.currency,
                                reason: "fraudulent",
                                stripeChargeId: stripeCheckoutChargeMock.id
                            })
                        ],
                        has_more: false,
                        url: null
                    }
                };
            }

            // Create & post webhook event locally (live events DO get triggered during live testing,
            // but we can't use them because they get posted to the lamdba, not sent back in an http response)
            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
            chai.assert.equal(webhookResp.statusCode, 204);

            // Check that transaction chain & values are in the expected state
            // NOTE if we ever start returning responses before handling the event we might need to address timing here - see https://stripe.com/docs/webhooks#best-practices
            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2);
            chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "void", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true);
        }).timeout(8000);

        it("uses existing 'void' Transaction if original Transaction was pending and has been voided", async () => {
            // Setup: create Value and Checkout transaction
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50
            };
            const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
            chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: currency.code,
                lineItems: [{
                    type: "product",
                    productId: "pid",
                    unitPrice: 1000
                }],
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ],
                pending: true
            };
            const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
            if (!testStripeLive()) { // check that the stubbing is doing what it should
                chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
                chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
            }

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");
            chai.assert.isString(stripeChargeStep.chargeId);
            chai.assert.isObject(stripeChargeStep.charge);
            chai.assert.isFalse((stripeChargeStep.charge as stripe.charges.ICharge).captured);

            let refund: stripe.refunds.IRefund;
            if (testStripeLive()) {
                // Refund the charge manually first.  Executing the void should pick up this refund.
                refund = await createRefund({charge: stripeChargeStep.chargeId}, stripeLiveLightrailConfig.secretKey, stripeLiveMerchantConfig.stripeUserId);
            } else {
                // This is what effectively happens.  This mock kinda defeats the purpose of the test though.
                [refund] = stubStripeRefund(stripeCheckoutChargeMock);
            }

            // Void transaction through Lightrail
            const voidTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/void`, "POST", {id: generateId()});
            chai.assert.equal(voidTransactionResponse.statusCode, 201, `voidTransactionResponse.body=${JSON.stringify(voidTransactionResponse)}`);
            chai.assert.isNotNull(voidTransactionResponse.body.steps.find(step => step.rail === "stripe"));

            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

                // if live testing, need to make sure the charge and refund actually exist in Stripe
                const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
                chai.assert.isNotNull(chargeFromStripe);
                chai.assert.equal(chargeFromStripe.refunds.data.length, 1);
            }

            // Create & post webhook event locally (live events DO get triggered during live testing,
            // but we can't use them because they get posted to the lamdba, not sent back in an http response)
            const refundedCharge = {
                ...stripeChargeStep.charge,
                refunded: true,
                refunds: {
                    object: "list",
                    data: [
                        generateStripeRefundResponse({
                            amount: stripeChargeStep.charge.amount,
                            currency: stripeChargeStep.charge.currency,
                            reason: "fraudulent",
                            stripeChargeId: stripeChargeStep.charge.id
                        })
                    ],
                    has_more: false,
                    url: null
                }
            };
            const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedCharge);
            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
            chai.assert.equal(webhookResp.statusCode, 204);

            // Check that transaction chain & values are as expected
            // Transaction chain already had 'reverse'
            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2);
            chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            // Value was not frozen before, should be now
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
            chai.assert.deepEqual(fetchValueResp.body.metadata, {stripeWebhookTriggeredAction: `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${checkoutRequest.id}' with reverse transaction '${voidTransactionResponse.body.id}', Stripe chargeId: '${refundedCharge.id}', Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `value metadata: ${JSON.stringify(fetchValueResp.body.metadata)}`);

        });
    });

    it("reverses Lightrail transaction & freezes Values for Stripe refunds updated with 'reason: fraudulent'");
});


/**
 * See https://stripe.com/docs/webhooks/signatures#verify-manually for details about generating signed requests
 * @param router The webhook event router
 * @param body To test handling Stripe events, use the Event object structure: https://stripe.com/docs/api/events
 */
async function testSignedWebhookRequest(router: cassava.Router, body: any) {
    const lightrailStripeConfig = await getLightrailStripeModeConfig(true);
    const t = (Math.floor(Date.now() / 1000));
    const bodyString = JSON.stringify(body);
    const sig = cryptojs.HmacSHA256(`${t}.${bodyString}`, lightrailStripeConfig.connectWebhookSigningSecret);

    return await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/stripeEventWebhook", "POST", {
        headers: {
            "Stripe-Signature": `t=${t},v1=${sig},v0=${sig}`
        },
        body: bodyString
    }));
}

/**
 * Generates a dummy Stripe webhook event
 * @param eventType Possible Event types: https://stripe.com/docs/api/events/types
 * @param eventObject Events contain the object they describe (eg an event describing a charge contains the full Charge object)
 * Re 'account' property in return type: "For these events [i.e. Connect events], there will be an additional account attribute in the received Event object." - https://stripe.com/docs/api/events
 */
function generateConnectWebhookEventMock(eventType: string, eventObject: stripe.IObject): stripe.events.IEvent & { account: string } {
    return {
        id: generateId(),
        type: eventType,
        account: stripeLiveMerchantConfig.stripeUserId,
        object: "event",
        data: {
            object: eventObject
        },
        api_version: stripeApiVersion,
        created: Date.now(),
        livemode: false,
        pending_webhooks: 1
    };
}

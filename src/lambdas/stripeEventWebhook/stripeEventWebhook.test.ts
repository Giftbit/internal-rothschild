import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    generateStripeChargeResponse,
    setStubsForStripeTests,
    stripeLiveLightrailConfig,
    stripeLiveMerchantConfig,
    stubCheckoutStripeCharge,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {createCurrency} from "../rest/currencies";
import {Currency} from "../../model/Currency";
import {CheckoutRequest} from "../../model/TransactionRequest";
import * as stripe from "stripe";
import {Contact} from "../../model/Contact";
import {generateConnectWebhookEventMock, testSignedWebhookRequest} from "../../utils/testUtils/webhookHandlerTestUtils";

/**
 * Webhook handling tests follow this format:
 * 1. Setup: create Value and Checkout transaction.
 * 2. Create the refund in Stripe with 'reason: fraudulent'. When running live, this triggers a live webhook event.
 * 3. Make sure the charge actually exists in Stripe if live testing.
 * 4. Create & post a mock webhook event locally. This means even "live" tests use a mock. Live events get triggered
 *      during live testing, but we can't use them for unit tests because they are sent to the webhook endpoint.
 * 5. Assert that transaction chain & values are in the expected state.
 *      Note, if we ever start returning responses before handling the event we might need to address timing here.
 *      See https://stripe.com/docs/webhooks#best-practices
 */
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
        currency: currency.code,
        balance: 50
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

        await setCodeCryptographySecrets();

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

    it("reverses Lightrail transaction & freezes Values for Stripe refunds created with 'reason: fraudulent'", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
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

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        let refundedCharge: stripe.charges.ICharge;
        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

        const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        chai.assert.isNotNull(chargeFromStripe);

        refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
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

    it("logs Stripe eventId & Connected accountId in metadata", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

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

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        let refundedCharge: stripe.charges.ICharge;
        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

        const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        chai.assert.isNotNull(chargeFromStripe);

        refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedCharge);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const reverseTransaction: Transaction = fetchTransactionChainResp.body[1];
        chai.assert.deepEqual(reverseTransaction.metadata, {stripeWebhookTriggeredAction: `Transaction reversed by Lightrail because Stripe charge '${refundedCharge.id}' was refunded as fraudulent. Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `reverseTransaction metadata: ${JSON.stringify(reverseTransaction.metadata)}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        chai.assert.deepEqual(fetchValueResp.body.metadata, {stripeWebhookTriggeredAction: `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${checkoutRequest.id}' with reverse/void transaction '${reverseTransaction.id}', Stripe chargeId: '${refundedCharge.id}', Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `value metadata: ${JSON.stringify(fetchValueResp.body.metadata)}`);
    }).timeout(8000);

    describe("handles scenarios - action already taken in Lightrail", () => {
        it("Lightrail transaction already reversed", async function () {
            if (!testStripeLive()) {
                this.skip();
                return;
            }

            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
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

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

            let refundedCharge: stripe.charges.ICharge;

            const reversedTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: generateId()});
            chai.assert.equal(reversedTransactionResponse.statusCode, 201, `reversedTransactionResponse.body=${JSON.stringify(reversedTransactionResponse)}`);
            chai.assert.isNotNull(reversedTransactionResponse.body.steps.find(step => step.rail === "stripe"));

            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

            const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            chai.assert.isNotNull(chargeFromStripe);
            chai.assert.equal(chargeFromStripe.refunds.data.length, 1);

            // Manual workaround: update refund on returned charge with 'reason: fraudulent' so the webhook safety checks will pass
            // Normal flow for a transaction reversed in Lightrail would be to do this through the Stripe dashboard
            refundedCharge = {...chargeFromStripe};
            refundedCharge.refunds.data[0].reason = "fraudulent";

            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
            chai.assert.equal(webhookResp.statusCode, 204);

            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2);
            chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        }).timeout(8000);

        it("Lightrail transaction already reversed and Values already frozen", async function () {
            if (!testStripeLive()) {
                this.skip();
                return;
            }

            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
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

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

            chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
            const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

            let refundedCharge: stripe.charges.ICharge;

            const reversedTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: generateId()});
            chai.assert.equal(reversedTransactionResponse.statusCode, 201, `reversedTransactionResponse.body=${JSON.stringify(reversedTransactionResponse)}`);
            chai.assert.isNotNull(reversedTransactionResponse.body.steps.find(step => step.rail === "stripe"));

            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

            const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            chai.assert.isNotNull(chargeFromStripe);
            chai.assert.equal(chargeFromStripe.refunds.data.length, 1);

            // Manual workaround: update refund on returned charge with 'reason: fraudulent' so the webhook safety checks will pass
            // Normal flow for a transaction reversed in Lightrail would be to do this through the Stripe dashboard
            refundedCharge = {...chargeFromStripe};
            refundedCharge.refunds.data[0].reason = "fraudulent";

            const freezeValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "PATCH", {frozen: true});
            chai.assert.equal(freezeValueResp.statusCode, 200, `freezeValueResp.body=${freezeValueResp.body}`);
            chai.assert.equal(freezeValueResp.body.frozen, true, `freezeValueResp.body.frozen=${freezeValueResp.body.frozen}`);

            const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
            chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${webhookResp.body}`);

            const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
            chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
            chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance, `fetchValueResp.body.balance=${fetchValueResp.body.balance}`);
            chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        }).timeout(8000);
    });

    it("freezes Values attached to Contact used as a payment source", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const contact: Partial<Contact> = {
            id: generateId()
        };
        const value1: Partial<Value> = {
            id: generateId(),
            contactId: contact.id,
            currency: currency.code,
            balance: 100,
        };
        const value2: Partial<Value> = {
            id: generateId(),
            contactId: contact.id,
            currency: currency.code,
            balance: 200,
            redemptionRule: {
                rule: "true == false",
                explanation: "never applies but should still get frozen in this test"
            }
        };
        const postContactResp = await testUtils.testAuthedRequest<Contact>(restRouter, "/v2/contacts", "POST", contact);
        chai.assert.equal(postContactResp.statusCode, 201, `body=${JSON.stringify(postContactResp.body)}`);
        const postValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value1);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);
        const postValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value2);
        chai.assert.equal(postValue2Resp.statusCode, 201, `body=${JSON.stringify(postValue2Resp.body)}`);

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
                    contactId: contact.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ]
        };

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.equal(checkoutResp.body.steps.length, 2, `checkoutResp.body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
        chai.assert.isObject(checkoutResp.body.steps.find(step => (step as LightrailTransactionStep).valueId === value1.id));

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        let refundedCharge: stripe.charges.ICharge;
        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

        const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        chai.assert.isNotNull(chargeFromStripe);

        refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(fetchValue1Resp.statusCode, 200, `fetchValueResp.body=${fetchValue1Resp.body}`);
        chai.assert.equal(fetchValue1Resp.body.balance, value1.balance, `fetchValue1Resp.body.balance=${fetchValue1Resp.body.balance}`);
        chai.assert.equal(fetchValue1Resp.body.frozen, true, `fetchValue1Resp.body.frozen=${fetchValue1Resp.body.frozen}`);

        const fetchValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value2.id}`, "GET");
        chai.assert.equal(fetchValue2Resp.statusCode, 200, `fetchValueResp.body=${fetchValue2Resp.body}`);
        chai.assert.equal(fetchValue2Resp.body.balance, value2.balance, `fetchValue2Resp.body.balance=${fetchValue2Resp.body.balance}`);
        chai.assert.equal(fetchValue2Resp.body.frozen, true, `fetchValue2Resp.body.frozen=${fetchValue2Resp.body.frozen}`);
    }).timeout(8000);

    it("does not freeze generic values - attached or unattached", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const contact: Partial<Contact> = {
            id: generateId()
        };
        const genericValue1: Partial<Value> = {
            id: generateId(),
            isGenericCode: true,
            code: "USEME",
            currency: currency.code,
            balance: 100,
        };
        const genericValue2: Partial<Value> = {
            id: generateId(),
            isGenericCode: true,
            code: "CONTACTME",
            currency: currency.code,
            balance: 200,
        };
        const genericValue3: Partial<Value> = {
            id: generateId(),
            isGenericCode: true,
            code: "CONTACTME2",
            currency: currency.code,
            balance: 50,
        };
        const postContactResp = await testUtils.testAuthedRequest<Contact>(restRouter, "/v2/contacts", "POST", contact);
        chai.assert.equal(postContactResp.statusCode, 201, `body=${JSON.stringify(postContactResp.body)}`);
        const postValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", genericValue1);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);
        const postValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", genericValue2);
        chai.assert.equal(postValue2Resp.statusCode, 201, `body=${JSON.stringify(postValue2Resp.body)}`);
        const attachValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: genericValue2.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachValue2Resp.statusCode, 200, `attachValue2Resp.body=${JSON.stringify(attachValue2Resp.body)}`);
        const postValue3Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", genericValue3);
        chai.assert.equal(postValue3Resp.statusCode, 201, `body=${JSON.stringify(postValue3Resp.body)}`);
        const attachValue3Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: genericValue3.id
        });
        chai.assert.equal(attachValue3Resp.statusCode, 200, `attachValue3Resp.body=${JSON.stringify(attachValue3Resp.body)}`);

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
                    valueId: genericValue1.id
                },
                {
                    rail: "lightrail",
                    contactId: contact.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ]
        };

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        let refundedCharge: stripe.charges.ICharge;
        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

        const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        chai.assert.isNotNull(chargeFromStripe);

        refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${genericValue1.id}`, "GET");
        chai.assert.equal(fetchValue1Resp.statusCode, 200, `fetchValueResp.body=${fetchValue1Resp.body}`);
        chai.assert.equal(fetchValue1Resp.body.balance, genericValue1.balance, `fetchValue1Resp.body=${JSON.stringify(fetchValue1Resp.body)}`);
        chai.assert.equal(fetchValue1Resp.body.frozen, false, `fetchValue1Resp.body.frozen=${fetchValue1Resp.body.frozen}`);
        const fetchValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${genericValue2.id}`, "GET");
        chai.assert.equal(fetchValue2Resp.statusCode, 200, `fetchValueResp.body=${fetchValue2Resp.body}`);
        chai.assert.equal(fetchValue2Resp.body.balance, genericValue2.balance);
        chai.assert.equal(fetchValue2Resp.body.frozen, false, `fetchValue2Resp.body.frozen=${fetchValue2Resp.body.frozen}`);
        const fetchValue3Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${genericValue3.id}`, "GET");
        chai.assert.equal(fetchValue3Resp.statusCode, 200, `fetchValueResp.body=${fetchValue3Resp.body}`);
        chai.assert.equal(fetchValue3Resp.body.balance, genericValue3.balance);
        chai.assert.equal(fetchValue3Resp.body.frozen, false, `fetchValue2Resp.body.frozen=${fetchValue3Resp.body.frozen}`);
    }).timeout(12000);
});

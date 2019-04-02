import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {createUSDCheckout, generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    generateStripeChargeResponse,
    setStubsForStripeTests,
    stripeLiveMerchantConfig,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {CheckoutRequest} from "../../model/TransactionRequest";
import * as stripe from "stripe";
import {Contact} from "../../model/Contact";
import {
    assertTransactionChainContainsTypes,
    assertValuesRestoredAndFrozen,
    generateConnectWebhookEventMock,
    refundInStripe,
    setupForWebhookEvent,
    testSignedWebhookRequest
} from "../../utils/testUtils/webhookHandlerTestUtils";

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

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        await setCodeCryptographySecrets();

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

    it("does nothing for refunds that do not indicate fraud activity", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
        const refundedCharge = await refundInStripe(webhookEventSetup.stripeStep);

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204);

        await assertTransactionChainContainsTypes(restRouter, checkout.id, 1, ["checkout"]);
        for (const v of values) {
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${v.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200);
            chai.assert.equal(fetchValueResp.body.balance, 0);
        }
    });

    it("reverses Lightrail transaction & freezes Values for Stripe refunds created with 'reason: fraudulent'", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
        const refundedCharge = await refundInStripe(checkout.steps.find(step => step.rail === "stripe") as StripeTransactionStep, "fraudulent");

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkout.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        for (const value of values) {
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance);
            chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        }
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
        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
        const refundedCharge = await refundInStripe(checkout.steps.find(step => step.rail === "stripe") as StripeTransactionStep, "fraudulent");

        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedCharge);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204);

        const chain = await assertTransactionChainContainsTypes(restRouter, checkout.id, 2, ["checkout", "reverse"]);
        const reverseTransaction: Transaction = chain[1];
        chai.assert.deepEqual(reverseTransaction.metadata, {stripeWebhookTriggeredAction: `Transaction reversed by Lightrail because Stripe charge '${refundedCharge.id}' was refunded as fraudulent. Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `reverseTransaction metadata: ${JSON.stringify(reverseTransaction.metadata)}`);

        await assertValuesRestoredAndFrozen(restRouter, values, true);
    }).timeout(8000);

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
            currency: "USD",
            balance: 100,
        };
        const value2: Partial<Value> = {
            id: generateId(),
            contactId: contact.id,
            currency: "USD",
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
            currency: "USD",
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

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {initialCheckoutReq: checkoutRequest});
        const checkout = webhookEventSetup.checkout;

        chai.assert.equal(checkout.steps.length, 2, `checkout${JSON.stringify(checkout.steps)}`);
        chai.assert.isObject(checkout.steps.find(step => (step as LightrailTransactionStep).valueId === value1.id));

        const refundedCharge = await refundInStripe(webhookEventSetup.stripeStep, "fraudulent");

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        await assertTransactionChainContainsTypes(restRouter, checkout.id, 2, ["checkout", "reverse"]);

        await assertValuesRestoredAndFrozen(restRouter, [postValue1Resp.body, postValue2Resp.body], true);
        await assertValuesRestoredAndFrozen(restRouter, webhookEventSetup.valuesCharged, true);
    }).timeout(8000);

    it("does not freeze generic values - attached or unattached", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const contact: Partial<Contact> = {
            id: generateId()
        };
        const genericUsedDirectlyInCheckout: Partial<Value> = {
            id: generateId(),
            isGenericCode: true,
            code: "USEME",
            currency: "USD",
            balance: 100,
        };
        const genericAttachedAsNewValue: Partial<Value> = {
            id: generateId(),
            isGenericCode: true,
            code: "CONTACTME",
            currency: "USD",
            balance: 200,
        };
        const genericAttachedRegular: Partial<Value> = {
            id: generateId(),
            isGenericCode: true,
            code: "CONTACTME2",
            currency: "USD",
            balance: 50,
        };
        const postContactResp = await testUtils.testAuthedRequest<Contact>(restRouter, "/v2/contacts", "POST", contact);
        chai.assert.equal(postContactResp.statusCode, 201, `body=${JSON.stringify(postContactResp.body)}`);
        const postValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", genericUsedDirectlyInCheckout);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);

        const postValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", genericAttachedAsNewValue);
        chai.assert.equal(postValue2Resp.statusCode, 201, `body=${JSON.stringify(postValue2Resp.body)}`);
        const attachValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: genericAttachedAsNewValue.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachValue2Resp.statusCode, 200, `attachValue2Resp.body=${JSON.stringify(attachValue2Resp.body)}`);

        const postValue3Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", genericAttachedRegular);
        chai.assert.equal(postValue3Resp.statusCode, 201, `body=${JSON.stringify(postValue3Resp.body)}`);
        const attachValue3Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: genericAttachedRegular.id
        });
        chai.assert.equal(attachValue3Resp.statusCode, 200, `attachValue3Resp.body=${JSON.stringify(attachValue3Resp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: "USD",
            lineItems: [{
                type: "product",
                productId: "pid",
                unitPrice: 1000
            }],
            sources: [
                {
                    rail: "lightrail",
                    valueId: genericUsedDirectlyInCheckout.id
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

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {initialCheckoutReq: checkoutRequest});
        const checkout = webhookEventSetup.checkout;

        const refundedCharge = await refundInStripe(webhookEventSetup.stripeStep, "fraudulent");

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        await assertTransactionChainContainsTypes(restRouter, checkout.id, 2, ["checkout", "reverse"]);

        const fetchValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${genericUsedDirectlyInCheckout.id}`, "GET");
        chai.assert.equal(fetchValue1Resp.statusCode, 200, `fetchValueResp.body=${fetchValue1Resp.body}`);
        chai.assert.equal(fetchValue1Resp.body.balance, genericUsedDirectlyInCheckout.balance, `fetchValue1Resp.body=${JSON.stringify(fetchValue1Resp.body)}`);
        chai.assert.equal(fetchValue1Resp.body.frozen, false, `fetchValue1Resp.body.frozen=${fetchValue1Resp.body.frozen}`);
        const fetchValue2Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${genericAttachedAsNewValue.id}`, "GET");
        chai.assert.equal(fetchValue2Resp.statusCode, 200, `fetchValueResp.body=${fetchValue2Resp.body}`);
        chai.assert.equal(fetchValue2Resp.body.balance, genericAttachedAsNewValue.balance);
        chai.assert.equal(fetchValue2Resp.body.frozen, false, `fetchValue2Resp.body.frozen=${fetchValue2Resp.body.frozen}`);
        const fetchValue3Resp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${genericAttachedRegular.id}`, "GET");
        chai.assert.equal(fetchValue3Resp.statusCode, 200, `fetchValueResp.body=${fetchValue3Resp.body}`);
        chai.assert.equal(fetchValue3Resp.body.balance, genericAttachedRegular.balance);
        chai.assert.equal(fetchValue3Resp.body.frozen, false, `fetchValue2Resp.body.frozen=${fetchValue3Resp.body.frozen}`);
    }).timeout(12000);

    describe("utility - 'assertTransactionChainContainsTypes'", () => {
        it("fetches & checks chain correctly - checkout + reverse", async () => {
            const checkoutSetup = await createUSDCheckout(restRouter, null, false);

            await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
            const reverseResp = await testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutSetup.checkout.id}/reverse`, "POST", {id: generateId()});

            const chainFromCheckout = await assertTransactionChainContainsTypes(restRouter, checkoutSetup.checkout.id, 2, ["checkout", "reverse"]);
            const chainFromReverse = await assertTransactionChainContainsTypes(restRouter, reverseResp.body.id, 2, ["checkout", "reverse"]);
            chai.assert.deepEqual(chainFromCheckout, chainFromReverse, `chainFromCheckout=${JSON.stringify(chainFromCheckout)} \nchainFromReverse=${JSON.stringify(chainFromReverse)}`);
        });

        it("fetches & checks chain correctly - pending checkout + capture + reverse", async () => {
            const checkoutSetup = await createUSDCheckout(restRouter, {pending: true}, false);

            await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
            const captureResp = await testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutSetup.checkout.id}/capture`, "POST", {id: generateId()});

            await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
            const reverseResp = await testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${captureResp.body.id}/reverse`, "POST", {id: generateId()});

            const chainFromCheckout = await assertTransactionChainContainsTypes(restRouter, checkoutSetup.checkout.id, 3, ["checkout", "capture", "reverse"]);
            const chainFromCaptureResp = await assertTransactionChainContainsTypes(restRouter, captureResp.body.id, 3, ["checkout", "capture", "reverse"]);
            const chainFromReverseResp = await assertTransactionChainContainsTypes(restRouter, reverseResp.body.id, 3, ["checkout", "capture", "reverse"]);
            chai.assert.deepEqual(chainFromCheckout, chainFromCaptureResp, `chainFromCheckout2=${JSON.stringify(chainFromCheckout)}, \nchainFromCaptureResp=${JSON.stringify(chainFromCaptureResp)}`);
            chai.assert.deepEqual(chainFromCheckout, chainFromReverseResp, `chainFromCheckout2=${JSON.stringify(chainFromCheckout)}, \nchainFromReverseResp2=${JSON.stringify(chainFromReverseResp)}`);
        });
    });
});

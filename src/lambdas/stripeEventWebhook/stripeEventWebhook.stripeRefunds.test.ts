import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    generateStripeRefundResponse,
    setStubsForStripeTests,
    stripeLiveLightrailConfig,
    stripeLiveMerchantConfig,
    stubCheckoutStripeCharge,
    stubStripeRefund,
    stubStripeRetrieveCharge,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {StripeTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {createCurrency} from "../rest/currencies";
import {Currency} from "../../model/Currency";
import {CheckoutRequest} from "../../model/TransactionRequest";
import * as stripe from "stripe";
import {generateConnectWebhookEventMock, testSignedWebhookRequest} from "../../utils/testUtils/webhookHandlerTestUtils";
import sinon from "sinon";
import log = require("loglevel");

describe("/v2/stripeEventWebhook - Stripe Refund events", () => {
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

    it("reverses Lightrail transaction & freezes Values for Stripe refunds updated with 'reason: fraudulent'", async function () {
        if (!testStripeLive()) {
            log.warn("Setting up stubs to run this test locally is too complex to be worthwhile.");
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
        const [stripeCheckoutChargeMock] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        if (!testStripeLive()) {
            chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeCheckoutChargeMock.id);
            chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeCheckoutChargeMock, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
        }

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        let refund: stripe.refunds.IRefund;
        let refundedCharge: stripe.charges.ICharge;
        if (testStripeLive()) {
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

            const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            chai.assert.isNotNull(chargeFromStripe);

            refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            refund = refundedCharge.refunds.data[0];

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
            refund = refundedCharge.refunds.data[0];

            stubStripeRetrieveCharge(refundedCharge);
        }

        const webhookEvent = generateConnectWebhookEventMock("charge.refund.updated", refund);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp.body)}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance, `fetchValueResp.body.balance=${fetchValueResp.body.balance}`);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
    }).timeout(8000);

    it("throws Sentry error for Stripe refunds with 'status: failed'", async function () {
        if (!testStripeLive()) {
            log.warn("Setting up stubs to run this test locally is too complex to be worthwhile.");
            this.skip();
            return;
        }

        let sandbox = sinon.createSandbox();
        (giftbitRoutes.sentry.sendErrorNotification as any).restore();
        const stub = sandbox.stub(giftbitRoutes.sentry, "sendErrorNotification");

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

        let refund: stripe.refunds.IRefund;
        let refundedCharge: stripe.charges.ICharge;
        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

        const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        chai.assert.isNotNull(chargeFromStripe);

        refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        refund = refundedCharge.refunds.data[0];
        refund.status = "failed";
        refund.failure_reason = "unknown";

        const webhookEvent = generateConnectWebhookEventMock("charge.refund.updated", refund);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp.body)}`);

        const errorRegex = new RegExp("Event of type 'charge.refund.updated', eventId '\.\+', accountId '\.\+' indicates a refund failure with failure reason 'unknown'.");
        sinon.assert.calledWith(stub, sinon.match.instanceOf(Error));
        sinon.assert.calledWith(stub, sinon.match.has("message", sinon.match(errorRegex)));
    }).timeout(8000);
});

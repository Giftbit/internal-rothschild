import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../utils/testUtils";
import {setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {setStubsForStripeTests, testStripeLive, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import {LightrailTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {
    generateConnectWebhookEventMock,
    setupForWebhookEvent,
    testSignedWebhookRequest
} from "../../utils/testUtils/webhookHandlerTestUtils";
import sinon from "sinon";

describe("/v2/stripeEventWebhook - Stripe Refund events", () => {
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

    it("reverses Lightrail transaction & freezes Values for Stripe refunds updated with 'reason: fraudulent'", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {refunded: true, refundReason: "fraudulent"});
        const checkout = webhookEventSetup.checkout;
        const value = webhookEventSetup.value;
        const refund = webhookEventSetup.stripeChargeAfterRefund.refunds.data[0];

        const webhookEvent = generateConnectWebhookEventMock("charge.refund.updated", refund);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp.body)}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkout.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "reverse", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const valueId = (checkout.steps.find(src => src.rail === "lightrail") as LightrailTransactionStep).valueId;
        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${valueId}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance, `fetchValueResp.body.balance=${fetchValueResp.body.balance}`);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
    }).timeout(8000);

    it("throws Sentry error for Stripe refunds with 'status: failed'", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        let sandbox = sinon.createSandbox();
        (giftbitRoutes.sentry.sendErrorNotification as any).restore();
        const stub = sandbox.stub(giftbitRoutes.sentry, "sendErrorNotification");

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {refunded: true, refundReason: "fraudulent"});
        const refund = webhookEventSetup.stripeChargeAfterRefund.refunds.data[0];

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

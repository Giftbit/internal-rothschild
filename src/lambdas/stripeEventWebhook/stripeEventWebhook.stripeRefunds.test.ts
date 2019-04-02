import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../utils/testUtils";
import {setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {setStubsForStripeTests, testStripeLive, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import {StripeTransactionStep} from "../../model/Transaction";
import {
    assertTransactionChainContainsTypes,
    assertValuesRestoredAndFrozen,
    generateConnectWebhookEventMock,
    refundInStripe,
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

        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
        const refundedCharge = await refundInStripe(checkout.steps.find(step => step.rail === "stripe") as StripeTransactionStep, "fraudulent");
        const refund = refundedCharge.refunds.data[0];

        const webhookEvent = generateConnectWebhookEventMock("charge.refund.updated", refund);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp.body)}`);

        await assertTransactionChainContainsTypes(restRouter, checkout.id, 2, ["checkout", "reverse"]);
        await assertValuesRestoredAndFrozen(restRouter, values, true);
    }).timeout(12000);

    it("throws Sentry error for Stripe refunds with 'status: failed'", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        let sandbox = sinon.createSandbox();
        (giftbitRoutes.sentry.sendErrorNotification as any).restore();
        const stub = sandbox.stub(giftbitRoutes.sentry, "sendErrorNotification");

        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const refundedCharge = await refundInStripe(webhookEventSetup.checkout.steps.find(step => step.rail === "stripe") as StripeTransactionStep, "fraudulent");
        const refund = refundedCharge.refunds.data[0];

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

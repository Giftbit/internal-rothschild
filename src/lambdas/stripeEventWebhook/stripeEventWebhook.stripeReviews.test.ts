import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRest} from "./installStripeEventWebhookRest";
import * as chai from "chai";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import * as stripe from "stripe";
import {
    assertTransactionChainContainsTypes,
    assertValuesRestoredAndFrozen,
    generateConnectWebhookEventMock,
    refundInStripe,
    setupForWebhookEvent,
    testSignedWebhookRequest
} from "../../utils/testUtils/webhookHandlerTestUtils";

describe("/v2/stripeEventWebhook - Stripe Review events", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRest(webhookEventRouter);
        setCodeCryptographySecrets();
        await setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("reverses Lightrail transaction & freezes Values for Stripe event 'review.closed' with 'reason: refunded_as_fraud'", async () => {
        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const refundedCharge = await refundInStripe(webhookEventSetup.stripeStep, "fraudulent");

        let review: stripe.reviews.IReview = {
            id: generateId(),
            object: "review",
            charge: refundedCharge,
            created: null,
            livemode: false,
            open: false,
            reason: "refunded_as_fraud",
        };
        const webhookEvent = generateConnectWebhookEventMock("review.closed", review);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        await assertTransactionChainContainsTypes(restRouter, webhookEventSetup.checkout.id, 2, ["checkout", "reverse"]);
        await assertValuesRestoredAndFrozen(restRouter, webhookEventSetup.valuesCharged);
    }).timeout(12000);
});

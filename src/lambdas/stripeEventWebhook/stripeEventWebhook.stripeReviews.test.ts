import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {setStubsForStripeTests, testStripeLive, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import {Value} from "../../model/Value";
import {Currency} from "../../model/Currency";
import * as stripe from "stripe";
import {
    checkValuesState,
    generateConnectWebhookEventMock,
    getAndCheckTransactionChain,
    refundInStripe,
    setupForWebhookEvent,
    testSignedWebhookRequest
} from "../../utils/testUtils/webhookHandlerTestUtils";

describe("/v2/stripeEventWebhook - Stripe Review events", () => {
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

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("reverses Lightrail transaction & freezes Values for Stripe event 'review.closed' with 'reason: refunded_as_fraud'", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter);
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
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

        await getAndCheckTransactionChain(restRouter, checkout.id, 2, ["checkout", "reverse"]);
        await checkValuesState(restRouter, values);
    }).timeout(12000);
});

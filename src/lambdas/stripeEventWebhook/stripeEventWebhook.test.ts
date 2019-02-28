import * as cassava from "cassava";
import * as cryptojs from "crypto-js";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";

describe("/v2/stripeEventWebhook", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("verifies event signatures", async () => {
        const webhookResp1 = await makeSignedWebhookRequest(webhookEventRouter, {});
        chai.assert.equal(webhookResp1.statusCode, 204);
        const webhookResp2 = await makeSignedWebhookRequest(webhookEventRouter, {foo: "bar"});
        chai.assert.equal(webhookResp2.statusCode, 204);
        const webhookResp3 = await makeSignedWebhookRequest(webhookEventRouter, {
            foo: "bar",
            baz: [1, null, "2", undefined, {three: 0.4}]
        });
        chai.assert.equal(webhookResp3.statusCode, 204);
    });
});


/**
 * See https://stripe.com/docs/webhooks/signatures#verify-manually for details about generating signed requests
 * @param router The webhook event router
 * @param body To test handling Stripe events, use the Event object structure: https://stripe.com/docs/api/events
 */
async function makeSignedWebhookRequest(router: cassava.Router, body: any) {
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

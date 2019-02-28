import log = require("loglevel");
import Stripe = require("stripe");
import * as cassava from "cassava";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeModeConfig} from "../../utils/stripeUtils/StripeConfig";
import * as giftbitRoutes from "giftbit-cassava-routes";


export function installStripeEventWebhookRoute(router: cassava.Router): void {
    // These paths are configured in our Stripe account and not publicly known
    // (not that it would do any harm as we verify signatures).
    router.route("/v2/stripeEventWebhook")
        .method("POST")
        .handler(async evt => {
            // todo - configure metrics logging to show test/live mode for these requests. MetricsRoute currently relies on the jwt but that doesn't apply here.
            const testMode: boolean = !evt.body.livemode;
            const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(testMode);
            const stripe = new Stripe(lightrailStripeConfig.secretKey);

            try {
                log.info("Verifying Stripe signature...");
                const event = stripe.webhooks.constructEvent(evt.bodyRaw, evt.headersLowerCase["stripe-signature"], lightrailStripeConfig.connectWebhookSigningSecret);
                log.info("Stripe signature verified");

                // todo send 2xx immediately if signature verifies - otherwise it may time out, which means failure, which means the webhook could get turned off
                // todo handle event
            } catch (err) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNAUTHORIZED, "The Stripe signature could not be validated");
            }

            return {
                statusCode: 204,
                body: null
            };
        });
}

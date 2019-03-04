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
            const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(false);
            const stripe = new Stripe(lightrailStripeConfig.secretKey);

            try {
                log.info("Verifying Stripe signature...");
                const event = stripe.webhooks.constructEvent(evt.bodyRaw, evt.headersLowerCase["stripe-signature"], lightrailStripeConfig.connectWebhookSigningSecret);
                log.info("Stripe signature verified");

                // todo handle event
            } catch (err) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNAUTHORIZED, "The Stripe signature could not be validated");
            }

            return {
                statusCode: 204,
                body: null
            };
        });

    router.route("/v2/stripeTestEventWebhook")
        .method("POST")
        .handler(async evt => {
            const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(true);
            const stripe = new Stripe(lightrailStripeConfig.secretKey);

            try {
                log.info("Verifying Stripe signature...");
                const event = stripe.webhooks.constructEvent(evt.bodyRaw, evt.headersLowerCase["stripe-signature"], lightrailStripeConfig.connectWebhookSigningSecret);
                log.info("Stripe signature verified");

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

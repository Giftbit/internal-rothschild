import log = require("loglevel");
import Stripe = require("stripe");
import * as stripe from "stripe";
import * as cassava from "cassava";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeModeConfig} from "../../utils/stripeUtils/StripeConfig";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";


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

async function handleRefundForFraud(event: stripe.events.IEvent & { account: string }): Promise<void> {
}

/**
 * This is a workaround method. When we can get the Lightrail userId directly from the Stripe accountId, we won't need to pass in the charge.
 * @param stripeAccountId
 * @param stripeCharge
 */
function getAuthBadgeFromStripeCharge(stripeAccountId: string, stripeCharge: stripe.charges.ICharge): giftbitRoutes.jwtauth.AuthorizationBadge {
    const lightrailUserId = getLightrailUserIdFromStripeCharge(stripeAccountId, stripeCharge);

    return new AuthorizationBadge({
        g: {
            gui: lightrailUserId,
            tmi: lightrailUserId,
        }
    });
}

/**
 * This is a workaround method. For now, it relies on finding the Lightrail userId directly in the charge metadata.
 * This is not reliable or safe as a permanent solution; it's waiting on the new user service to provide a direct mapping
 * from Stripe accountId to Lightrail userId. When that happens, we won't need to pass the charge object in.
 * @param stripeAccountId
 * @param stripeCharge
 */
function getLightrailUserIdFromStripeCharge(stripeAccountId: string, stripeCharge: stripe.charges.ICharge): string {
    if (stripeCharge.metadata["lightrailUserId"] && stripeCharge.metadata["lightrailUserId"].length > 0) {
        return stripeCharge.metadata["lightrailUserId"];
    } else {
        throw new Error(`Could not get Lightrail userId from Stripe accountId ${stripeAccountId} and charge ${stripeCharge.id}`);
    }
}
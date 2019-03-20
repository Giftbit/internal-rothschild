import * as cassava from "cassava";
import * as cryptojs from "crypto-js";
import {generateId} from "../../utils/testUtils";
import {stripeLiveMerchantConfig} from "../../utils/testUtils/stripeTestUtils";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {stripeApiVersion} from "../../utils/stripeUtils/StripeConfig";
import * as stripe from "stripe";

/**
 * See https://stripe.com/docs/webhooks/signatures#verify-manually for details about generating signed requests
 * @param router The webhook event router
 * @param body To test handling Stripe events, use the Event object structure: https://stripe.com/docs/api/events
 */
export async function testSignedWebhookRequest(router: cassava.Router, body: any) {
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

/**
 * Generates a dummy Stripe webhook event
 * @param eventType Possible Event types: https://stripe.com/docs/api/events/types
 * @param eventObject Events contain the object they describe (eg an event describing a charge contains the full Charge object)
 * Re 'account' property in return type: "For these events [i.e. Connect events], there will be an additional account attribute in the received Event object." - https://stripe.com/docs/api/events
 */
export function generateConnectWebhookEventMock(eventType: string, eventObject: stripe.IObject): stripe.events.IEvent & { account: string } {
    return {
        id: generateId(),
        type: eventType,
        account: stripeLiveMerchantConfig.stripeUserId,
        object: "event",
        data: {
            object: eventObject
        },
        api_version: stripeApiVersion,
        created: Date.now(),
        livemode: false,
        pending_webhooks: 1
    };
}

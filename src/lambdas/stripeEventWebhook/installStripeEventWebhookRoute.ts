import * as cassava from "cassava";

export function installStripeEventWebhookRoute(router: cassava.Router): void {
    // These paths are configured in our Stripe account and not publicly known
    // (not that it would do any harm as we verify signatures).
    router.route("/v2/stripeEventWebhook")
        .method("POST")
        .handler(evt => {
            // const stripe = new Stripe("apiKey");
            //
            // // this should throw an error if the signature fails
            // const event = stripe.webhooks.constructEvent(evt.body, evt.headersLowerCase["stripe-signature"], "endpoint-secret");

            return {
                statusCode: 204,
                body: null
            };
        });

    router.route("/v2/stripeTestEventWebhook")
        .method("POST")
        .handler(evt => {
            // const stripe = new Stripe("apiKey");
            //
            // // this should throw an error if the signature fails
            // const event = stripe.webhooks.constructEvent(evt.body, evt.headersLowerCase["stripe-signature"], "endpoint-secret");

            return {
                statusCode: 204,
                body: null
            };
        });
}

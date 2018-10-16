import {StripeUpdateChargeParams} from "./StripeUpdateChargeParams";
import {StripeRestError} from "./StripeRestError";
import {StripeCreateChargeParams} from "./StripeCreateChargeParams";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {stripeApiVersion} from "./StripeConfig";
import {StripeCreateRefundParams} from "./StripeCreateRefundParams";
import log = require("loglevel");
import Stripe = require("stripe");
import IRefund = Stripe.refunds.IRefund;
import ICharge = Stripe.charges.ICharge;

export async function createCharge(params: StripeCreateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string, stepIdempotencyKey: string): Promise<ICharge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info(`Creating Stripe charge ${JSON.stringify(params)}.`);
    console.log(`createCharge called ${JSON.stringify(params)}.`);

    let charge: ICharge;
    try {
        charge = await lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
            idempotency_key: stepIdempotencyKey
        });
    } catch (err) {
        log.warn(`Error charging Stripe: ${err}`);

        switch (err.type) { // todo improve handling: most stripe errors come with a 'code' or 'decline_code' attribute that we can use to handle more cases more gracefully
            case "StripeIdempotencyError":
                throw new StripeRestError(409, `Stripe idempotency error: a charge already exists in Stripe with the idempotency key '${err.headers["idempotency-key"]}'. This key was generated by Lightrail from the checkout transaction ID for the charge '${JSON.stringify(params)}'.`, "StripeIdempotencyError", err);

            case "StripeCardError":
                throw new StripeRestError(422, "Card declined.", "StripeCardDeclined", err);

            case "StripeInvalidRequestError":
                if (err.code === "amount_too_small") {
                    throw new StripeRestError(422, `Failed to charge credit card: amount '${params.amount}' for Stripe was too small.`, "StripeAmountTooSmall", err);
                }
                throw new StripeRestError(422, "The stripeCardToken was invalid.", "StripeInvalidRequestError", err);

            case "RateLimitError":
                throw new StripeRestError(429, `Service was rate limited by dependent service.`, "DependentServiceRateLimited", err); // technically this is up to us to handle once we're past mvp stage: since we are sending the requests, we should take responsibility for spacing & retrying

            default:
                throw new Error(`An unexpected error occurred while attempting to charge card. error ${err}`);
        }
    }
    log.info(`Created Stripe charge '${charge.id}'`);
    console.log(`Created Stripe charge '${JSON.stringify(charge)}'`);
    return charge;
}

export async function createRefund(params: StripeCreateRefundParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<IRefund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info(`Creating refund for Stripe charge ${params.chargeId}.`);
    console.log(`createRefund called ${JSON.stringify(params)}.`);
    const refund = await lightrailStripe.refunds.create({
        charge: params.chargeId,
        metadata: {reason: params.reason || "not specified"} /* Doesn't show up in charge in stripe. Need to update charge so that it's obvious as to why it was refunded. */
    }, {
        stripe_account: merchantStripeAccountId
    });
    try {
        await updateCharge(params.chargeId, {
            description: params.reason
        }, lightrailStripeSecretKey, merchantStripeAccountId);
    } catch (err) {
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
    log.info(`Created Stripe refund for charge ${params.chargeId}: ${JSON.stringify(refund)}`);
    console.log(`Created Stripe refund for charge ${params.chargeId}: ${JSON.stringify(refund)}`);
    return refund;
}

export async function updateCharge(chargeId: string, params: StripeUpdateChargeParams, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info(`Updating Stripe charge ${JSON.stringify(params)}.`);
    let chargeUpdate;
    try {
        chargeUpdate = await lightrailStripe.charges.update(
            chargeId,
            params, {
                stripe_account: merchantStripeAccountId,
            }
        );  // todo make this a DTO.
    } catch (err) {
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
    log.info(`Updated Stripe charge ${JSON.stringify(chargeUpdate)}.`);
    return chargeUpdate;
}

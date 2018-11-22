import {StripeRestError} from "./StripeRestError";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {stripeApiVersion} from "./StripeConfig";
import log = require("loglevel");
import Stripe = require("stripe");
import {charges} from "stripe";

export async function createCharge(params: Stripe.charges.IChargeCreationOptions, lightrailStripeSecretKey: string, merchantStripeAccountId: string, stepIdempotencyKey: string): Promise<Stripe.charges.ICharge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info("Creating Stripe charge", params);

    try {
        const charge = await lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
            idempotency_key: stepIdempotencyKey
        });
        log.info(`Created Stripe charge '${charge.id}'`);
        return charge;
    } catch (err) {
        log.warn("Error charging Stripe:", err);

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
}

export async function createRefund(params: Stripe.refunds.IRefundCreationOptionsWithCharge, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Stripe.refunds.IRefund> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info("Creating refund for Stripe charge", params.charge);
    try {
        const refund = await lightrailStripe.refunds.create(params, {
            stripe_account: merchantStripeAccountId
        });
        log.info("Created Stripe refund for charge", params.charge, refund);
        return refund;
    } catch (err) {
        log.warn("Err refunding Stripe:", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

export async function createCapture(chargeId: string, options: Stripe.charges.IChargeCaptureOptions, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<Stripe.charges.ICharge> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info("Creating capture for Stripe charge", chargeId);
    try {
        const capturedCharge = await lightrailStripe.charges.capture(chargeId, options, {
            stripe_account: merchantStripeAccountId
        });
        log.info("Created Stripe capture for charge", chargeId, capturedCharge);
        return capturedCharge;
    } catch (err) {
        log.warn("Error capturing Stripe charge:", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

export async function updateCharge(chargeId: string, params: Stripe.charges.IChargeUpdateOptions, lightrailStripeSecretKey: string, merchantStripeAccountId: string): Promise<any> {
    const lightrailStripe = require("stripe")(lightrailStripeSecretKey);
    lightrailStripe.setApiVersion(stripeApiVersion);
    log.info("Updating Stripe charge", params);
    try {
        const chargeUpdate = await lightrailStripe.charges.update(
            chargeId,
            params, {
                stripe_account: merchantStripeAccountId,
            }
        );
        log.info("Updated Stripe charge", chargeUpdate);
        return chargeUpdate;
    } catch (err) {
        log.warn("Error updating Stripe charge:", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

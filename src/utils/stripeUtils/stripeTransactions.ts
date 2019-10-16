import {StripeRestError} from "./StripeRestError";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import {getStripeClient} from "./stripeAccess";
import log = require("loglevel");
import Stripe = require("stripe");
import {GiftbitRestError} from "giftbit-cassava-routes";

export async function createCharge(params: Stripe.charges.IChargeCreationOptions, isTestMode: boolean, merchantStripeAccountId: string, stepIdempotencyKey: string): Promise<Stripe.charges.ICharge> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Creating Stripe charge", params, merchantStripeAccountId);

    try {
        const charge = await lightrailStripe.charges.create(params, {
            stripe_account: merchantStripeAccountId,
            idempotency_key: stepIdempotencyKey
        });
        log.info(`Created Stripe charge '${charge.id}'`);
        return charge;
    } catch (err) {
        log.warn("Error charging Stripe:", err);

        checkForStandardStripeErrors(err);
        switch (err.type) {
            case "StripeIdempotencyError":
                throw new StripeRestError(cassava.httpStatusCode.clientError.CONFLICT, `Stripe idempotency error: a charge already exists in Stripe with the idempotency key '${err.headers["idempotency-key"]}'. This key was generated by Lightrail from the checkout transaction ID for the charge '${JSON.stringify(params)}'.`, "StripeIdempotencyError", err);
            case "StripeCardError":
                if (isIdempotentReplayError(err)) {
                    const nextStepIdempotencyKeyAndCount = getRetryIdempotencyKeyAndCount(stepIdempotencyKey);
                    if (nextStepIdempotencyKeyAndCount.count < 5) {
                        return await createCharge(params, isTestMode, merchantStripeAccountId, nextStepIdempotencyKeyAndCount.newKey);
                    }
                }
                throw  new StripeRestError(cassava.httpStatusCode.clientError.CONFLICT, "Your card was declined.", "StripeCardDeclined", err);
            case "StripeInvalidRequestError":
                if (err.code === "amount_too_small") {
                    throw new StripeRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Failed to charge credit card: amount '${params.amount}' for Stripe was too small.`, "StripeAmountTooSmall", err);
                }
                throw new StripeRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Your request can not be completed. Code from Stripe: '${err.code}'`, "StripeInvalidRequestError", err);
            default:
                throw err;
        }
    }
}

export async function createRefund(params: Stripe.refunds.IRefundCreationOptionsWithCharge, isTestMode: boolean, merchantStripeAccountId: string): Promise<Stripe.refunds.IRefund> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Creating refund for Stripe charge", params, merchantStripeAccountId);
    try {
        const refund = await lightrailStripe.refunds.create(params, {
            stripe_account: merchantStripeAccountId
        });
        log.info("Created Stripe refund for charge", params.charge, refund);
        return refund;
    } catch (err) {
        log.warn("Error refunding Stripe:", err);

        checkForStandardStripeErrors(err);
        if ((err as Stripe.IStripeError).code === "charge_already_refunded") {
            // Refunds are sorted most recent first, so we only need one.
            const refunds = await lightrailStripe.charges.listRefunds(params.charge, {limit: 1}, {stripe_account: merchantStripeAccountId});
            if (refunds.data.length === 0) {
                throw new Error(`Attempting to refund charge '${params.charge}' resulted in 'charge_already_refunded' but listing refunds returned nothing.`);
            } else {
                return refunds.data[0];
            }
        }
        if ((err as Stripe.IStripeError).code === "charge_disputed") {
            // We could change this behaviour in the future.  For example it seems safe that if the
            // dispute is settled we go ahead with the reverse.  Reversing with an unsettled dispute is
            // less clear.  Accepting the dispute and then reversing is riskier still.
            throw new StripeRestError(409, `Stripe charge '${params.charge}' cannot be refunded because it is disputed.`, "StripeChargeDisputed", err);
        }
        if ((err as Stripe.IStripeError).code === "resource_missing" && (err as Stripe.IStripeError).param === "id") {
            // The Stripe charge was not found.  In production mode this indicates a serious problem.
            // In test mode this can be triggered by deleting Stripe test data so it isn't a problem.
            throw new StripeRestError(isTestMode ? 409 : 500, `Stripe charge '${params.charge}' cannot be refunded because it does not exist.`, "StripeChargeNotFound", err);
        }

        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

export async function captureCharge(chargeId: string, options: Stripe.charges.IChargeCaptureOptions, isTestMode: boolean, merchantStripeAccountId: string): Promise<Stripe.charges.ICharge> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Creating capture for Stripe charge", chargeId, merchantStripeAccountId);
    try {
        const capturedCharge = await lightrailStripe.charges.capture(chargeId, options, {
            stripe_account: merchantStripeAccountId
        });
        log.info("Created Stripe capture for charge", chargeId, capturedCharge);
        return capturedCharge;
    } catch (err) {
        log.warn("Error capturing Stripe charge:", err);

        checkForStandardStripeErrors(err);
        if ((err as Stripe.IStripeError).code === "charge_already_captured") {
            return await lightrailStripe.charges.retrieve(chargeId, {stripe_account: merchantStripeAccountId});
        }
        if ((err as Stripe.IStripeError).code === "charge_already_refunded") {
            throw new StripeRestError(409, `Stripe charge '${chargeId}' cannot be captured because it was refunded.`, "StripeChargeAlreadyRefunded", err);
        }

        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

export async function updateCharge(chargeId: string, params: Stripe.charges.IChargeUpdateOptions, isTestMode: boolean, merchantStripeAccountId: string): Promise<any> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Updating Stripe charge", chargeId, params, merchantStripeAccountId);
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
        checkForStandardStripeErrors(err);
        log.warn("Error updating Stripe charge:", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

export async function retrieveCharge(chargeId: string, isTestMode: boolean, merchantStripeAccountId: string): Promise<Stripe.charges.ICharge> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Retrieving Stripe charge", chargeId, merchantStripeAccountId);
    try {
        const charge = await lightrailStripe.charges.retrieve(chargeId, {stripe_account: merchantStripeAccountId});
        log.info("retrieved Stripe charge", charge);
        return charge;
    } catch (err) {
        checkForStandardStripeErrors(err);
        if (err.statusCode === 404) {
            throw new StripeRestError(404, `Charge not found: ${chargeId}`, null, err);
        }
        log.warn("Error retrieving Stripe charge:", err);
        giftbitRoutes.sentry.sendErrorNotification(err);
        throw err;
    }
}

/**
 * So far this has only been used in test code.  It's not clear there will ever be
 * a need in production.
 */
export async function createCustomer(params: Stripe.customers.ICustomerCreationOptions, isTestMode: boolean, merchantStripeAccountId: string): Promise<Stripe.customers.ICustomer> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Creating Stripe customer", params);

    return await lightrailStripe.customers.create(params, {stripe_account: merchantStripeAccountId});
}

/**
 * So far this has only been used in test code.  It's not clear there will ever be
 * a need in production.
 */
export async function createCustomerSource(customerId: string, params: Stripe.customers.ICustomerSourceCreationOptions, isTestMode: boolean, merchantStripeAccountId: string): Promise<Stripe.IStripeSource> {
    const lightrailStripe = await getStripeClient(isTestMode);
    log.info("Creating Stripe card source", customerId, params);

    return await lightrailStripe.customers.createSource(customerId, params, {stripe_account: merchantStripeAccountId});
}

/**
 * Returns true if the error is an idempotent replay from a previous call.
 */
function isIdempotentReplayError(err: any): boolean {
    return err && err.headers && err.headers["idempotent-replayed"] === "true";
}

function checkForStandardStripeErrors(err: any): void {
    switch (err.type) {
        case "StripeRateLimitError":
            throw new StripeRestError(429, `Service was rate limited by dependent service.`, "DependentServiceRateLimited", err); // technically this is up to us to handle once we're past mvp stage: since we are sending the requests, we should take responsibility for spacing & retrying
        case "StripePermissionError":
            throw new StripeRestError(424, "Application access may have been revoked.", "StripePermissionError", err);
        case "StripeConnectionError":
        case "StripeAPIError":
            throw new StripeRestError(502, "There was a problem connecting to Stripe.", "StripeAPIError", err);
        default:
            // do nothing
    }
}

function getRetryIdempotencyKeyAndCount(stepIdempotencyKey: string): {newKey: string, count: number} {
    let originalStepIdempotencyKey = stepIdempotencyKey;
    let count = 1;
    const retryCountMatcher = /^(.+)-retry-(\d)$/.exec(stepIdempotencyKey);
    if (retryCountMatcher) {
        originalStepIdempotencyKey = retryCountMatcher[1];
        count = +retryCountMatcher[2] + 1;
    }
    return {newKey: (originalStepIdempotencyKey + "-retry-" + count), count: count};
}

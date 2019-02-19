import log = require("loglevel");
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailAndMerchantStripeConfig, StripeConfig, StripeModeConfig} from "./StripeConfig";
import {StripeAuth} from "./StripeAuth";
import {httpStatusCode, RestError} from "cassava";
import * as kvsAccess from "../kvsAccess";

let assumeCheckoutToken: Promise<giftbitRoutes.secureConfig.AssumeScopeToken>;

export function initializeAssumeCheckoutToken(tokenPromise: Promise<giftbitRoutes.secureConfig.AssumeScopeToken>): void {
    assumeCheckoutToken = tokenPromise;
}

export async function setupLightrailAndMerchantStripeConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<LightrailAndMerchantStripeConfig> {
    const authorizeAs = auth.getAuthorizeAsPayload();

    if (!assumeCheckoutToken) {
        throw new Error("AssumeCheckoutToken has not been initialized.");
    }
    log.info("fetching retrieve stripe auth assume token");
    const assumeToken = (await assumeCheckoutToken).assumeToken;
    log.info("got retrieve stripe auth assume token");

    const lightrailStripeModeConfig = await getLightrailStripeModeConfig(auth.isTestUser());

    log.info("fetching merchant stripe auth");
    const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);
    log.info("got merchant stripe auth");
    validateStripeConfig(merchantStripeConfig, lightrailStripeModeConfig);

    return {merchantStripeConfig, lightrailStripeConfig: lightrailStripeModeConfig};
}

let lightrailStripeConfig: Promise<StripeConfig>;

export function initializeLightrailStripeConfig(lightrailStripePromise: Promise<StripeConfig>): void {
    lightrailStripeConfig = lightrailStripePromise;
}

/**
 * Get Stripe credentials for test or live mode.  Test mode credentials allow
 * dummy credit cards and skip through stripe connect.
 * @param testMode whether to use test account credentials or live credentials
 */
export async function getLightrailStripeModeConfig(testMode: boolean): Promise<StripeModeConfig> {
    if (!lightrailStripeConfig) {
        throw new Error("lightrailStripeConfig has not been initialized.");
    }
    return testMode ? (await lightrailStripeConfig).test : (await lightrailStripeConfig).live;
}

function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig) {
    if (!merchantStripeConfig || !merchantStripeConfig.stripe_user_id) {
        throw new GiftbitRestError(424, "Merchant stripe config stripe_user_id must be set.", "MissingStripeUserId");
    }
    if (!lightrailStripeConfig || !lightrailStripeConfig.secretKey) {
        log.debug("Lightrail stripe secretKey could not be loaded from s3 secure config.");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }
}

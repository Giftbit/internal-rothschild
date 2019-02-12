import log = require("loglevel");
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailAndMerchantStripeConfig, StripeConfig, StripeModeConfig} from "./StripeConfig";
import {StripeAuth} from "./StripeAuth";
import {httpStatusCode, RestError} from "cassava";
import * as kvsAccess from "../kvsAccess";

let assumeCheckoutToken: giftbitRoutes.secureConfig.AssumeScopeToken;

export async function setupLightrailAndMerchantStripeConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<LightrailAndMerchantStripeConfig> {
    const authorizeAs = auth.getAuthorizeAsPayload();

    if (!assumeCheckoutToken) {
        log.info("fetching retrieve stripe auth assume token");
        assumeCheckoutToken = await giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH");
    }
    const assumeToken = assumeCheckoutToken.assumeToken;
    log.info("got retrieve stripe auth assume token");

    log.info("fetching merchant stripe auth");
    const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);
    log.info("got merchant stripe auth");

    if (!lightrailStripeConfig) {
        lightrailStripeConfig = await getLightrailStripeConfig(auth.isTestUser());
    }
    validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);

    return {merchantStripeConfig, lightrailStripeConfig};
}

let lightrailStripeConfig: StripeModeConfig;

/**
 * Get Stripe credentials for test or live mode.  Test mode credentials allow
 * dummy credit cards and skip through stripe connect.
 * @param test whether to use test account credentials or live credentials
 */
async function getLightrailStripeConfig(test: boolean): Promise<StripeModeConfig> {
    const stripeConfig = await giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<StripeConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE");
    if (!stripeConfig.live && !stripeConfig.test) {
        // TEMP this is a short term measure to be able to use new code with old config files
        return stripeConfig as any;
    }
    return test ? stripeConfig.test : stripeConfig.live;
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

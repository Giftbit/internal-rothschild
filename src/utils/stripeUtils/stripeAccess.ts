// First two functions copied from internal-turnkey
// Minor modification made to facilitate testing: fetchFromS3ByEnvVar is called directly in getStripeConfig rather than in a promise, so that it can be mocked

import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {StripeConfig, StripeModeConfig} from "./StripeConfig";
import {StripeAuth} from "./StripeAuth";
import {httpStatusCode, RestError} from "cassava";
import * as kvsAccess from "../kvsAccess";

/**
 * Get Stripe credentials for test or live mode.  Test mode credentials allow
 * dummy credit cards and skip through stripe connect.
 * @param test whether to use test account credentials or live credentials
 */
export async function getStripeConfig(test: boolean): Promise<StripeModeConfig> {
    const stripeConfig = await giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<StripeConfig>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE");
    if (!stripeConfig.live && !stripeConfig.test) {
        // TEMP this is a short term measure to be able to use new code with old config files
        return stripeConfig as any;
    }
    return test ? stripeConfig.test : stripeConfig.live;
}

export function validateStripeConfig(merchantStripeConfig: StripeAuth, lightrailStripeConfig: StripeModeConfig) {
    if (!merchantStripeConfig || !merchantStripeConfig.stripe_user_id) {
        throw new GiftbitRestError(424, "Merchant stripe config stripe_user_id must be set.", "MissingStripeUserId");
    }
    if (!lightrailStripeConfig || !lightrailStripeConfig.secretKey) {
        console.log("Lightrail stripe secretKey could not be loaded from s3 secure config.");
        throw new RestError(httpStatusCode.serverError.INTERNAL_SERVER_ERROR);
    }
}

// This is a draft that's waiting for the rest of the system to get put together: might work but likely need to revisit assume token
export async function setupLightrailAndMerchantStripeConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge) {
    const authorizeAs = auth.getAuthorizeAsPayload();
    const assumeCheckoutToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_CHECKOUT_TOKEN");

    const assumeToken = (await assumeCheckoutToken).assumeToken;
    const merchantStripeConfig: StripeAuth = await kvsAccess.kvsGet(assumeToken, "stripeAuth", authorizeAs);
    const lightrailStripeConfig = await getStripeConfig(auth.isTestUser());
    validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);

    return {merchantStripeConfig, lightrailStripeConfig};
}

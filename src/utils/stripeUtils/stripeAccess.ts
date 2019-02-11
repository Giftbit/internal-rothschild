import log = require("loglevel");
import * as giftbitRoutes from "giftbit-cassava-routes";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {LightrailAndMerchantStripeConfig, StripeConfig, StripeModeConfig} from "./StripeConfig";
import {StripeAuth} from "./StripeAuth";
import {httpStatusCode, RestError} from "cassava";
import * as kvsAccess from "../kvsAccess";

let stripeConfigPromise: Promise<LightrailAndMerchantStripeConfig>;

export async function getStripeConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<LightrailAndMerchantStripeConfig> {
    if (!stripeConfigPromise) {
        if (!merchantStripeConfigPromise) {
            initializeMerchantStripeConfig(auth);
        }
        const merchantStripeConfig = await merchantStripeConfigPromise;
        const lightrailStripeConfig = await getLightrailStripeConfig(auth.isTestUser());
        validateStripeConfig(merchantStripeConfig, lightrailStripeConfig);

        stripeConfigPromise = Promise.resolve({merchantStripeConfig, lightrailStripeConfig});
    }
    return await stripeConfigPromise;
}

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

let merchantStripeConfigPromise: Promise<StripeAuth>;

function initializeMerchantStripeConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
    merchantStripeConfigPromise = getMerchantStripeConfig(auth);
}

async function getMerchantStripeConfig(auth: giftbitRoutes.jwtauth.AuthorizationBadge): Promise<StripeAuth> {
    log.info("fetching retrieve stripe auth assume token");
    const assumeCheckoutToken = giftbitRoutes.secureConfig.fetchFromS3ByEnvVar<giftbitRoutes.secureConfig.AssumeScopeToken>("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH");
    const assumeToken = (await assumeCheckoutToken).assumeToken;
    log.info("got retrieve stripe auth assume token");

    log.info("fetching stripe auth");
    const merchantConfig = kvsAccess.kvsGet(assumeToken, "stripeAuth", auth.getAuthorizeAsPayload());
    log.info("got stripe auth");

    return merchantConfig;
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

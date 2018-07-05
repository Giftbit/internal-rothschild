// First two copied from internal-turnkey

import {StripeAuth} from "./StripeAuth";

/**
 * Stripe configuration values stored in secure config.
 */
export interface StripeConfig {
    email: string;
    test: StripeModeConfig;
    live: StripeModeConfig;
}

/**
 * Configuration particular to a mode in Stripe (live or test).
 */
export interface StripeModeConfig {
    clientId: string;
    secretKey: string;
    publishableKey: string;
}

export interface LightrailAndMerchantStripeConfig {
    lightrailStripeConfig: StripeModeConfig;
    merchantStripeConfig: StripeAuth;
}
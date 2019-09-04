import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";
import {initializeAssumeCheckoutToken, initializeLightrailStripeConfig} from "../stripeUtils/stripeAccess";
import {StripeModeConfig} from "../stripeUtils/StripeConfig";

const sinonSandbox = sinon.createSandbox();
let stubKvsGet: sinon.SinonStub;

/**
 * See .env.example for Stripe config details
 * This is "merchant" (connected account) config from stripe test account//pass: integrationtesting+merchant@giftbit.com // x39Rlf4TH3pzn29hsb#
 */
export const stripeLiveMerchantConfig = {
    stripeUserId: "acct_1BOVE6CM9MOvFvZK",
    customer: {
        id: "cus_CP4Zd1Dddy4cOH",
        defaultCard: "card_1C0GSUCM9MOvFvZK8VB29qaz",
        nonDefaultCard: "card_1C0ZH9CM9MOvFvZKyZZc2X4Z"
    }
};

/**
 * See .env.example for Stripe config details
 */
export const stripeLiveLightrailConfig: StripeModeConfig = {
    clientId: null,
    secretKey: process.env["LIGHTRAIL_STRIPE_TEST_SECRET_KEY"] || "",
    publishableKey: null,
    connectWebhookSigningSecret: "secret"
};

export function setStubsForStripeTests() {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    initializeAssumeCheckoutToken(Promise.resolve(testAssumeToken));

    initializeLightrailStripeConfig(Promise.resolve({
        email: "test@example.com",
        test: stripeLiveLightrailConfig,
        live: stripeLiveLightrailConfig
    }));

    stubKvsGet = sinonSandbox.stub(kvsAccess, "kvsGet");
    stubKvsGet
        .resolves({
            token_type: "bearer",
            stripe_user_id: stripeLiveMerchantConfig.stripeUserId
        });
}

/**
 * A hacky way to change the stub and define what accountId should show up next.
 */
export function stubNextStripeAuthAccountId(stripeAccountId: string): void {
    stubKvsGet.reset();
    stubKvsGet.onFirstCall()
        .resolves({
            token_type: "bearer",
            stripe_user_id: stripeAccountId
        });
    stubKvsGet
        .resolves({
            token_type: "bearer",
            stripe_user_id: stripeLiveMerchantConfig.stripeUserId
        });
}

export function unsetStubsForStripeTests() {
    sinonSandbox.restore();
    stubKvsGet = null;
}

export function testStripeLive(): boolean {
    return process.env["TEST_STRIPE_LOCAL"] !== "true";
}

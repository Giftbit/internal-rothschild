import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";
import {
    getStripeClient,
    initializeAssumeCheckoutToken,
    initializeLightrailStripeConfig
} from "../stripeUtils/stripeAccess";
import {StripeModeConfig} from "../stripeUtils/StripeConfig";
import {defaultTestUser} from "./index";
import {TestUser} from "./TestUser";

const sinonSandbox = sinon.createSandbox();

/**
 * See .env.example for Stripe config details
 */
export const stripeLiveLightrailConfig: StripeModeConfig = {
    clientId: null,
    secretKey: process.env["LIGHTRAIL_STRIPE_TEST_SECRET_KEY"] || "",
    publishableKey: null,
    connectWebhookSigningSecret: "secret"
};

let stripeUserIds: { [token: string]: string } = {};

export async function setStubsForStripeTests(): Promise<void> {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    initializeAssumeCheckoutToken(Promise.resolve(testAssumeToken));

    initializeLightrailStripeConfig(Promise.resolve({
        email: "test@example.com",
        test: stripeLiveLightrailConfig,
        live: stripeLiveLightrailConfig
    }));

    if (testStripeLive()) {
        stripeUserIds = {
            [defaultTestUser.userId]: defaultTestUser.stripeAccountId
        };
    } else {
        const stripe = await getStripeClient(true);
        const account = await stripe.accounts.create({
            type: "standard",
            id: defaultTestUser.stripeAccountId
        } as any);
        stripeUserIds = {
            [defaultTestUser.userId]: account.id
        };
    }

    sinonSandbox.stub(kvsAccess, "kvsGet")
        .callsFake((token: string, key: string, authorizeAs?: string) => {
            if (key !== "stripeAuth") {
                throw new Error("We haven't mocked any other KVS keys yet.");
            }
            if (!authorizeAs) {
                throw new Error("We haven't mocked calls without authorizeAs.");
            }
            const userId = JSON.parse(Buffer.from(authorizeAs, "base64").toString("ascii")).g.gui;
            if (!stripeUserIds[userId]) {
                return Promise.resolve(null);
            }
            return Promise.resolve({
                token_type: "bearer",
                stripe_user_id: stripeUserIds[userId]
            });
        });
}

export function setStubbedStripeUserId(testUser: TestUser): void {
    if (!testUser.stripeAccountId) {
        throw new Error("TestUser.stripeAccountId not set");
    }
    stripeUserIds[testUser.userId] = testUser.stripeAccountId;
}

export function unsetStubsForStripeTests(): void {
    sinonSandbox.restore();
}

export function testStripeLive(): boolean {
    return process.env["TEST_STRIPE_LOCAL"] !== "true";
}

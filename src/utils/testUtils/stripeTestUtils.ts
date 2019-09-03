import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";
import {CheckoutRequest, TransactionParty} from "../../model/TransactionRequest";
import {initializeAssumeCheckoutToken, initializeLightrailStripeConfig} from "../stripeUtils/stripeAccess";
import {Transaction} from "../../model/Transaction";
import * as cassava from "cassava";
import {Value} from "../../model/Value";
import {StripeModeConfig} from "../stripeUtils/StripeConfig";
import stripe = require("stripe");

const sinonSandbox = sinon.createSandbox();
let stubKvsGet: sinon.SinonStub;

/**
 * See .env.example for Stripe config details
 * This is "merchant" (connected account) config from stripe test account//pass: integrationtesting+merchant@giftbit.com // x39Rlf4TH3pzn29hsb#
 */
export const stripeLiveMerchantConfig = {
    stripeUserId: "acct_1BOVE6CM9MOvFvZK",
    connectWebhookSigningSecret: "",
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
    connectWebhookSigningSecret: null
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

export interface GenerateStripeChargeResponseOptions {
    transactionId: string;
    amount: number;
    currency: string;
    pending: boolean;
    sources?: TransactionParty[];
    metadata?: object;
    additionalProperties?: Partial<stripe.charges.ICharge>;
}

export function generateStripeChargeResponse(options: GenerateStripeChargeResponseOptions): stripe.charges.ICharge {
    throw new Error("delete me");
}

export interface GenerateStripeRefundResponseOptions {
    amount: number;
    currency: string;
    stripeChargeId: string;
    reason?: string;
    additionalProperties?: Partial<stripe.refunds.IRefund>;
}

export function generateStripeRefundResponse(options: GenerateStripeRefundResponseOptions): stripe.refunds.IRefund {
    throw new Error("delete me");
}

export async function createStripeUSDCheckout(router: cassava.Router, checkoutProps?: Partial<CheckoutRequest>): Promise<{ checkout: Transaction, valuesCharged: Value[] }> {
    throw new Error("delete me");
}

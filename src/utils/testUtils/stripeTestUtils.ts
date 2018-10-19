import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";

let sinonSandbox = sinon.createSandbox();

export const STRIPE_TEST_CONFIG = {
    secretKey: "sk_test_Fwb3uGyZsIb9eJ5ZQchNH5Em",
    stripeUserId: "acct_1BOVE6CM9MOvFvZK",
    customer: {
        id: "cus_CP4Zd1Dddy4cOH",
        defaultCard: "card_1C0GSUCM9MOvFvZK8VB29qaz",
        nonDefaultCard: "card_1C0ZH9CM9MOvFvZKyZZc2X4Z"
    }
};

export function setStubsForStripeTests() {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    let stubFetchFromS3ByEnvVar = sinonSandbox.stub(giftbitRoutes.secureConfig, "fetchFromS3ByEnvVar");
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH").resolves(testAssumeToken);
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE").resolves({
        email: "test@test.com",
        test: {
            clientId: "test-client-id",
            secretKey: testStripeLive() ? STRIPE_TEST_CONFIG.secretKey : "test",
            publishableKey: "test-pk",
        },
        live: {}
    });

    let stubKvsGet = sinonSandbox.stub(kvsAccess, "kvsGet");
    stubKvsGet.withArgs(sinon.match(testAssumeToken.assumeToken), sinon.match("stripeAuth"), sinon.match.string).resolves({
        token_type: "bearer",
        stripe_user_id: testStripeLive() ? STRIPE_TEST_CONFIG.stripeUserId : "test",
    });
}

export function unsetStubsForStripeTests() {
    sinonSandbox.restore();
}

export function testStripeLive(): boolean {
    return !!process.env["TEST_STRIPE_LIVE"];
}

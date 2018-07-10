import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";

export function setStubsForStripeTests() {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    let stubFetchFromS3ByEnvVar = sinon.stub(giftbitRoutes.secureConfig, "fetchFromS3ByEnvVar");
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_CHECKOUT_TOKEN").resolves(testAssumeToken);
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE").resolves({
        email: "test@test.com",
        test: {
            clientId: "test-client-id",
            secretKey: process.env["STRIPE_PLATFORM_KEY"],
            publishableKey: "test-pk",
        },
        live: {
            clientId: "test-live-client-id",
            secretKey: process.env["STRIPE_PLATFORM_KEY"],  // this is a bit problematic: we should be testing with test keys (that's what this is right now)
            publishableKey: "test-live-pk",
        },
    });

    let stubKvsGet = sinon.stub(kvsAccess, "kvsGet");
    stubKvsGet.withArgs(sinon.match(testAssumeToken.assumeToken), sinon.match("stripeAuth"), sinon.match.string).resolves({
        token_type: "bearer",
        stripe_user_id: process.env["STRIPE_CONNECTED_ACCOUNT_ID"],
    });
}

export function unsetStubsForStripeTests() {
    (giftbitRoutes.secureConfig.fetchFromS3ByEnvVar as any).restore();
    (kvsAccess.kvsGet as any).restore();
}

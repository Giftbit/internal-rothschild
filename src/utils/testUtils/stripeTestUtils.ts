import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";

export function setStubsForStripeTests() {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    let stubFetchFromS3ByEnvVar = sinon.stub(giftbitRoutes.secureConfig, "fetchFromS3ByEnvVar");
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH").resolves(testAssumeToken);
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE").resolves({
        email: "test@test.com",
        test: {
            clientId: "test-client-id",
            secretKey: process.env["STRIPE_PLATFORM_KEY"],
            publishableKey: "test-pk",
        },
        live: {}
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

export function stripeEnvVarsPresent(): boolean {
    if (
        !!process.env["STRIPE_PLATFORM_KEY"] &&
        !!process.env["STRIPE_CONNECTED_ACCOUNT_ID"] &&
        !!process.env["STRIPE_CUSTOMER_ID"] &&
        !!process.env["SECURE_CONFIG_BUCKET"] &&
        !!process.env["SECURE_CONFIG_KEY_STRIPE"] &&
        !!process.env["SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH"]
    ) {
        return true;
    } else {
        console.log("Missing environment variables required to run Stripe-related tests: skipping. See readme to set up.");
        return false;
    }
}
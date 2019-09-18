import * as chai from "chai";
import * as sinon from "sinon";
import * as kvsAccess from "../kvsAccess";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getMerchantStripeAuth, initializeAssumeCheckoutToken} from "./stripeAccess";

describe("stripeAccess", () => {
    describe("getMerchantStripeAuth", () => {

        let sinonSandbox: sinon.SinonSandbox;

        const auth1 = new giftbitRoutes.jwtauth.AuthorizationBadge();
        auth1.userId = auth1.teamMemberId = "user1";

        const auth2 = new giftbitRoutes.jwtauth.AuthorizationBadge();
        auth2.userId = auth2.teamMemberId = "user2";

        before(() => {
            const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
                assumeToken: "this-is-an-assume-token"
            };
            initializeAssumeCheckoutToken(Promise.resolve(testAssumeToken));

            sinonSandbox = sinon.createSandbox();
            const stubKvsGet = sinonSandbox.stub(kvsAccess, "kvsGet");
            stubKvsGet
                .withArgs(sinon.match(testAssumeToken.assumeToken), sinon.match("stripeAuth"), sinon.match(auth1.getAuthorizeAsPayload()))
                .resolves({
                    token_type: "bearer",
                    stripe_user_id: "acct_stripe_user_id1",
                })
                .withArgs(sinon.match(testAssumeToken.assumeToken), sinon.match("stripeAuth"), sinon.match(auth2.getAuthorizeAsPayload()))
                .resolves({
                    token_type: "bearer",
                    stripe_user_id: "acct_stripe_user_id2",
                });
        });

        after(() => {
            sinonSandbox.restore();
        });

        it("does not leak StripeAuths between different auth badges", async () => {
            const stripeAuth1 = await getMerchantStripeAuth(auth1);
            chai.assert.equal(stripeAuth1.stripe_user_id, "acct_stripe_user_id1");

            const stripeAuth2 = await getMerchantStripeAuth(auth2);
            chai.assert.equal(stripeAuth2.stripe_user_id, "acct_stripe_user_id2");

            chai.assert.notDeepEqual(stripeAuth1, stripeAuth2);
        });
    });
});

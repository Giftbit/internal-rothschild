import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import Stripe from "stripe";
import * as sinon from "sinon";
import * as superagent from "superagent";
import * as kvsAccess from "../kvsAccess";
import * as stripeAccess from "./stripeAccess";
import {setStubsForStripeTests, testStripeLive, unsetStubsForStripeTests} from "../testUtils/stripeTestUtils";
import {CheckoutRequest} from "../../model/TransactionRequest";
import * as testUtils from "../testUtils";
import * as transactions from "../../lambdas/rest/transactions/transactions";
import * as valueStores from "../../lambdas/rest/values/values";
import * as currencies from "../../lambdas/rest/currencies";
import {StripeRestError} from "./StripeRestError";
import {updateCharge} from "./stripeTransactions";
import {Transaction} from "../../model/Transaction";
import {StripeTransactionStep} from "../../model/TransactionStep";

describe("stripeAccess", () => {
    describe("getMerchantStripeAuth()", () => {

        let sinonSandbox: sinon.SinonSandbox;

        const auth1 = new giftbitRoutes.jwtauth.AuthorizationBadge();
        auth1.userId = auth1.teamMemberId = "user1";

        const auth2 = new giftbitRoutes.jwtauth.AuthorizationBadge();
        auth2.userId = auth2.teamMemberId = "user2";

        before(() => {
            const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
                assumeToken: "this-is-an-assume-token"
            };
            stripeAccess.initializeAssumeCheckoutToken(Promise.resolve(testAssumeToken));

            sinonSandbox = sinon.createSandbox();
            sinonSandbox.stub(kvsAccess, "kvsGet")
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
            const stripeAuth1 = await stripeAccess.getMerchantStripeAuth(auth1);
            chai.assert.equal(stripeAuth1.stripe_user_id, "acct_stripe_user_id1");

            const stripeAuth2 = await stripeAccess.getMerchantStripeAuth(auth2);
            chai.assert.equal(stripeAuth2.stripe_user_id, "acct_stripe_user_id2");

            chai.assert.notDeepEqual(stripeAuth1, stripeAuth2);
        });

        it("returns 503 if KVS is inaccessible", async () => {
            const superAgentError: superagent.HTTPError = new Error("Error") as any;
            superAgentError.status = 500;
            superAgentError.method = "GET";
            superAgentError.text = "Error";

            sinonSandbox.restore();
            sinonSandbox.stub(kvsAccess, "kvsGet")
                .throwsException(superAgentError);

            let error: giftbitRoutes.GiftbitRestError = null;
            try {
                await stripeAccess.getMerchantStripeAuth(auth1);
                chai.assert.fail("if you are here the stub failed to do its job");
            } catch (e) {
                error = e;
            }

            chai.assert.isDefined(error);
            chai.assert.isTrue(error.isRestError, "is a giftbit rest error");
            chai.assert.equal(error.statusCode, 503);
        });
    });

    describe("Stripe connection errors", function () {
        const router = new cassava.Router();

        before(async () => {
            await testUtils.resetDb();
            router.route(testUtils.authRoute);
            transactions.installTransactionsRest(router);
            valueStores.installValuesRest(router);
            currencies.installCurrenciesRest(router);

            await testUtils.createUSD(router);
            await testUtils.createUSDValue(router, {balance: 5000});

            await setStubsForStripeTests();
        });

        const sinonSandbox = sinon.createSandbox();

        afterEach(() => {
            sinonSandbox.restore();
        });

        after(() => {
            unsetStubsForStripeTests();
        });

        it("returns 429 on Stripe RateLimitError", async function () {
            if (testStripeLive()) {
                // This test uses a special token only implemented in the mock server.
                this.skip();
            }

            const request: CheckoutRequest = {
                id: testUtils.generateId(),
                allowRemainder: true,
                sources: [
                    {
                        rail: "stripe",
                        source: "tok_429"
                    }
                ],
                lineItems: [
                    {
                        productId: "socks",
                        unitPrice: 500
                    }
                ],
                currency: "USD"
            };

            const checkout = await testUtils.testAuthedRequest<StripeRestError>(router, "/v2/transactions/checkout", "POST", request);
            chai.assert.equal(checkout.statusCode, 429);
        });

        it("throws a 502 if there is a StripeConnectionError", async function () {
            // If data is sent to a host that supports Discard Protocol on TCP or UDP port 9.
            // The data sent to the server is simply discarded and no response is returned.
            stubStripeClientHost(sinonSandbox, "localhost", 9, "http");

            const checkoutRequest: CheckoutRequest = {
                id: testUtils.generateId(),
                sources: [
                    {
                        rail: "stripe",
                        source: "tok_visa",
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 2000
                    }
                ],
                currency: "USD"
            };

            const checkoutResponse = await testUtils.testAuthedRequest<StripeRestError>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutResponse.statusCode, 502);
        });

        describe("Stripe client config", () => {
            it("retries requests three times (if none of the tries hit the global timeout)", async function () {
                // If data is sent to a host that supports Discard Protocol on TCP or UDP port 9.
                // The data sent to the server is simply discarded and no response is returned.
                stubStripeClientHost(sinonSandbox, "localhost", 9, "http");

                const checkoutRequest: CheckoutRequest = {
                    id: testUtils.generateId(),
                    sources: [
                        {
                            rail: "stripe",
                            source: "tok_visa",
                        }
                    ],
                    lineItems: [
                        {
                            type: "product",
                            productId: "xyz-123",
                            unitPrice: 2000
                        }
                    ],
                    currency: "USD"
                };

                const checkoutResponse = await testUtils.testAuthedRequest<StripeRestError>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                chai.assert.equal(checkoutResponse.statusCode, 502, `checkoutResponse=${JSON.stringify(checkoutResponse, null, 4)}`);
                chai.assert.isObject(JSON.parse(checkoutResponse.bodyRaw), `checkoutResponse=${JSON.stringify(checkoutResponse, null, 4)}`);
                chai.assert.isObject(JSON.parse(checkoutResponse.bodyRaw)["stripeError"], `checkoutResponse=${JSON.stringify(checkoutResponse, null, 4)}`);
                chai.assert.isString(JSON.parse(checkoutResponse.bodyRaw)["stripeError"].raw.message, `checkoutResponse=${JSON.stringify(checkoutResponse, null, 4)}`);
                chai.assert.match(JSON.parse(checkoutResponse.bodyRaw)["stripeError"].raw.message, /An error occurred with our connection to Stripe. Request was retried 3 times./);
            });

            it("lets requests time out after 27s (timeouts do not trigger retries)", async function () {
                const client = await stripeAccess.getStripeClient(true);
                chai.assert.equal((client as any)._api.timeout, 27000, `Stripe client global config should have 27s timeout: ${(client as any)._api}`);
            });

            it("only retries once for non-critical charge updates", async function () {
                const checkoutRequest: CheckoutRequest = {
                    id: testUtils.generateId(),
                    sources: [
                        {
                            rail: "stripe",
                            source: "tok_visa",
                        }
                    ],
                    lineItems: [
                        {
                            type: "product",
                            productId: "xyz-123",
                            unitPrice: 2000
                        }
                    ],
                    currency: "USD"
                };

                const checkoutResponse = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                chai.assert.equal(checkoutResponse.statusCode, 201, `checkoutResponse=${JSON.stringify(checkoutResponse, null, 4)}`);

                // If data is sent to a host that supports Discard Protocol on TCP or UDP port 9.
                // The data sent to the server is simply discarded and no response is returned.
                stubStripeClientHost(sinonSandbox, "localhost", 9, "http");

                try {
                    await updateCharge((checkoutResponse.body.steps[0] as StripeTransactionStep).charge.id, {description: "this is an update"}, true, testUtils.defaultTestUser.stripeAccountId, true);
                    chai.assert.fail("Call to update Stripe charge should have thrown an error");
                } catch (err) {
                    chai.assert.match(err.additionalParams.stripeError.raw.message, /Request was retried 1 time/);
                }
            });
        });
    });
});

function stubStripeClientHost(sandbox: sinon.SinonSandbox, host: string, port?: number, protocol = "http"): void {
    const getOriginalClient = stripeAccess.getStripeClient;
    sandbox.stub(stripeAccess, "getStripeClient")
        .callsFake(async function changeHost(): Promise<Stripe> {
            const client = await getOriginalClient.call(stripeAccess, true);
            client.setHost(host, port, protocol);
            return client;
        });
}

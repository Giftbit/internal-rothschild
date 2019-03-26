import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    generateStripeChargeResponse,
    setStubsForStripeTests,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import * as stripe from "stripe";
import {generateConnectWebhookEventMock, testSignedWebhookRequest} from "../../utils/testUtils/webhookHandlerTestUtils";
import sinon from "sinon";
import log = require("loglevel");

describe("/v2/stripeEventWebhook - Stripe Dispute events", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();
    let sandbox: sinon.SinonSandbox;

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        await setCodeCryptographySecrets();

        setStubsForStripeTests();
    });

    beforeEach(function () {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    function getDisputeLogMatcher(): RegExp {
        return new RegExp("MONITORING\\|\\d{10}\\|1\\|histogram\\|rothschild\\.stripeEventWebhook\\.dispute\\|#stripeEventType:charge.dispute.created,#stripeAccountId:acct_1BOVE6CM9MOvFvZK,#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
    }

    it("logs & metrics receipt of 'charge.dispute' events'", async () => {
        const spy = sandbox.spy(log, "info");

        const disputeMock: stripe.disputes.IDispute = {
            object: "dispute",
            id: generateId(),
            amount: 123,
            balance_transactions: null,
            charge: generateStripeChargeResponse({
                transactionId: generateId(),
                amount: 123,
                currency: "USD",
                pending: false,
                metadata: {
                    lightrailUserId: testUtils.defaultTestUser.userId
                },
            }),
            created: Date.now(),
            currency: null,
            evidence: null,
            evidence_details: null,
            is_charge_refundable: null,
            livemode: false,
            metadata: null,
            reason: "fraudulent",
            status: "needs_response"
        };

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.dispute.created", disputeMock));
        chai.assert.equal(webhookResp.statusCode, 204);

        sinon.assert.calledWith(spy, sinon.match(getDisputeLogMatcher()));
    });
});

import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    generateStripeRefundResponse,
    setStubsForStripeTests,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import * as stripe from "stripe";
import {
    buildStripeFraudRefundedChargeMock,
    checkValuesState,
    generateConnectWebhookEventMock,
    getAndCheckTransactionChain,
    setupForWebhookEvent,
    testSignedWebhookRequest
} from "../../utils/testUtils/webhookHandlerTestUtils";

describe("/v2/stripeEventWebhook - irreversible Lightrail Transactions", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        await setCodeCryptographySecrets();

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("uses existing 'reverse' Transaction", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {reversed: true});
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
        const nextLightrailTransaction = webhookEventSetup.nextLightrailTransaction;
        const refundedCharge = webhookEventSetup.finalStateStripeCharge;

        const stripeChargeMock = buildStripeFraudRefundedChargeMock(refundedCharge, webhookEventSetup.nextStripeStep.charge as stripe.refunds.IRefund);
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", stripeChargeMock);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body = ${JSON.stringify(webhookResp)}`);

        const chain1 = await getAndCheckTransactionChain(restRouter, checkout.id, 2, ["checkout", "reverse"]);
        const chain2 = await getAndCheckTransactionChain(restRouter, nextLightrailTransaction.id, 2, ["checkout", "reverse"]);
        chai.assert.deepEqual(chain1, chain2);
        await checkValuesState(restRouter, values, true);
    }).timeout(15000);

    it("voids instead of reversing if original Transaction was pending", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {initialCheckoutReq: {pending: true}});
        const checkout = webhookEventSetup.checkout;
        const values = webhookEventSetup.valuesCharged;
        const refundedCharge = webhookEventSetup.finalStateStripeCharge;

        const stripeChargeMock = buildStripeFraudRefundedChargeMock(refundedCharge, generateStripeRefundResponse({
            stripeChargeId: refundedCharge.id,
            amount: refundedCharge.amount,
            currency: refundedCharge.currency
        }));
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", stripeChargeMock));
        chai.assert.equal(webhookResp.statusCode, 204);

        await getAndCheckTransactionChain(restRouter, checkout.id, 2, ["checkout", "void"]);
        await checkValuesState(restRouter, values, true);
    }).timeout(12000);

    it("uses existing 'void' Transaction if original Transaction was pending and has been voided", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const webhookEventSetup = await setupForWebhookEvent(restRouter, {
            voided: true,
            initialCheckoutReq: {pending: true}
        });
        const checkout = webhookEventSetup.checkout;
        const charge = webhookEventSetup.stripeStep.charge;
        const values = webhookEventSetup.valuesCharged;
        const nextLightrailTransaction = webhookEventSetup.nextLightrailTransaction;
        const refundedCharge = webhookEventSetup.finalStateStripeCharge;

        chai.assert.isFalse((charge as stripe.charges.ICharge).captured);

        const stripeChargeMock = buildStripeFraudRefundedChargeMock(refundedCharge, webhookEventSetup.nextStripeStep.charge as stripe.refunds.IRefund);
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", stripeChargeMock);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        const chain1 = await getAndCheckTransactionChain(restRouter, checkout.id, 2, ["checkout", "void"]);
        const chain2 = await getAndCheckTransactionChain(restRouter, nextLightrailTransaction.id, 2, ["checkout", "void"]);
        chai.assert.deepEqual(chain1, chain2);
        await checkValuesState(restRouter, values, true);
    }).timeout(18000);
});

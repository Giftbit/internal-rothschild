import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRest} from "./installStripeEventWebhookRest";
import * as chai from "chai";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import * as stripe from "stripe";
import {
    assertTransactionChainContainsTypes,
    assertValuesRestoredAndFrozen,
    buildStripeFraudRefundedChargeMock,
    generateConnectWebhookEventMock,
    setupForWebhookEvent,
    testSignedWebhookRequest
} from "../../utils/testUtils/webhookHandlerTestUtils";
import {Value} from "../../model/Value";
import {Transaction} from "../../model/Transaction";
import {createRefund} from "../../utils/stripeUtils/stripeTransactions";

describe("/v2/stripeEventWebhook - irreversible Lightrail Transactions", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRest(webhookEventRouter);

        await setCodeCryptographySecrets();

        await setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("uses existing 'reverse' Transaction", async () => {
        const webhookEventSetup = await setupForWebhookEvent(restRouter, {reversed: true});

        const stripeChargeMock = buildStripeFraudRefundedChargeMock(webhookEventSetup.finalStateStripeCharge, webhookEventSetup.nextStripeStep.charge as stripe.refunds.IRefund);
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", stripeChargeMock);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body = ${JSON.stringify(webhookResp)}`);

        await assertTransactionChainContainsTypes(restRouter, webhookEventSetup.checkout.id, 2, ["checkout", "reverse"]);
        await assertValuesRestoredAndFrozen(restRouter, webhookEventSetup.valuesCharged, true);
    }).timeout(15000);

    it("succeeds when Values already frozen and Transaction has been reversed", async () => {
        const webhookEventSetup = await setupForWebhookEvent(restRouter, {reversed: true});
        const refundedCharge = buildStripeFraudRefundedChargeMock(webhookEventSetup.finalStateStripeCharge, webhookEventSetup.finalStateStripeCharge.refunds.data[0]);

        for (const value of webhookEventSetup.valuesCharged) {
            const freezeValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "PATCH", {frozen: true});
            chai.assert.equal(freezeValueResp.statusCode, 200, `freezeValueResp.body=${freezeValueResp.body}`);
            chai.assert.equal(freezeValueResp.body.frozen, true, `freezeValueResp.body.frozen=${freezeValueResp.body.frozen}`);
        }

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${webhookResp.body}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${webhookEventSetup.checkout.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        for (const value of webhookEventSetup.valuesCharged) {
            const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
            chai.assert.equal(fetchValueResp.body.balance, value.balance, `fetchValueResp.body.balance=${fetchValueResp.body.balance}`);
            chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        }
    }).timeout(8000);

    it("voids instead of reversing if original Transaction was pending", async () => {
        const webhookEventSetup = await setupForWebhookEvent(restRouter, {initialCheckoutReq: {pending: true}});

        const refund = await createRefund({
            charge: webhookEventSetup.stripeStep.charge.id
        }, true, testUtils.defaultTestUser.stripeAccountId);
        const stripeChargeMock = buildStripeFraudRefundedChargeMock(webhookEventSetup.finalStateStripeCharge, refund);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", stripeChargeMock));
        chai.assert.equal(webhookResp.statusCode, 204);

        await assertTransactionChainContainsTypes(restRouter, webhookEventSetup.checkout.id, 2, ["checkout", "void"]);
        await assertValuesRestoredAndFrozen(restRouter, webhookEventSetup.valuesCharged, true);
    }).timeout(12000);

    it("uses existing 'void' Transaction if original Transaction was pending and has been voided", async () => {
        const webhookEventSetup = await setupForWebhookEvent(restRouter, {
            voided: true,
            initialCheckoutReq: {pending: true}
        });

        chai.assert.isFalse((webhookEventSetup.stripeStep.charge as stripe.charges.ICharge).captured);

        const stripeChargeMock = buildStripeFraudRefundedChargeMock(webhookEventSetup.finalStateStripeCharge, webhookEventSetup.nextStripeStep.charge as stripe.refunds.IRefund);
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", stripeChargeMock);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        await assertTransactionChainContainsTypes(restRouter, webhookEventSetup.checkout.id, 2, ["checkout", "void"]);
        await assertValuesRestoredAndFrozen(restRouter, webhookEventSetup.valuesCharged, true);
    }).timeout(18000);

    it("reverses 'capture' Transaction if original Transaction was pending and has been captured", async () => {
        const webhookEventSetup = await setupForWebhookEvent(restRouter, {
            captured: true,
            initialCheckoutReq: {pending: true}
        });

        chai.assert.isTrue((webhookEventSetup.finalStateStripeCharge as stripe.charges.ICharge).captured, `Final state of Stripe charge from setup: ${JSON.stringify(webhookEventSetup.finalStateStripeCharge)}`);

        const stripeChargeMock = buildStripeFraudRefundedChargeMock(webhookEventSetup.finalStateStripeCharge, webhookEventSetup.nextStripeStep.charge as stripe.refunds.IRefund);
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", stripeChargeMock);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        await assertTransactionChainContainsTypes(restRouter, webhookEventSetup.checkout.id, 3, ["checkout", "capture", "reverse"]);
        await assertValuesRestoredAndFrozen(restRouter, webhookEventSetup.valuesCharged, true);
    }).timeout(8000);
});

import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    setStubsForStripeTests,
    stripeLiveLightrailConfig,
    stripeLiveMerchantConfig,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {StripeTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {createCurrency} from "../rest/currencies";
import {Currency} from "../../model/Currency";
import {CheckoutRequest} from "../../model/TransactionRequest";
import * as stripe from "stripe";
import {generateConnectWebhookEventMock, testSignedWebhookRequest} from "../../utils/testUtils/webhookHandlerTestUtils";

describe("/v2/stripeEventWebhook - irreversible Lightrail Transactions", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    const currency: Currency = {
        code: "CAD",
        name: "Antlers",
        symbol: "$",
        decimalPlaces: 2
    };

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        await setCodeCryptographySecrets();

        await createCurrency(testUtils.defaultTestUser.auth, currency);

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

        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 50
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: currency.code,
            lineItems: [{
                type: "product",
                productId: "pid",
                unitPrice: 1000
            }],
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ]
        };

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        let refundedCharge: stripe.charges.ICharge;

        const reversedTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(reversedTransactionResponse.statusCode, 201, `reversedTransactionResponse.body=${JSON.stringify(reversedTransactionResponse)}`);
        chai.assert.isNotNull(reversedTransactionResponse.body.steps.find(step => step.rail === "stripe"));

        if (testStripeLive()) {
            const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

            const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeChargeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
            chai.assert.isNotNull(chargeFromStripe);
            chai.assert.equal(chargeFromStripe.refunds.data.length, 1, `chargeFromStripe.refunds.data=${chargeFromStripe.refunds.data}`);

            // Manual workaround: update refund on returned charge with 'reason: fraudulent' so the webhook safety checks will pass
            // Normal flow for a transaction reversed in Lightrail would be to do this through the Stripe dashboard
            refundedCharge = {...chargeFromStripe};
            refundedCharge.refunds.data[0].reason = "fraudulent";
        }

        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedCharge);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body = ${JSON.stringify(webhookResp)}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        chai.assert.deepEqual(fetchValueResp.body.metadata, {stripeWebhookTriggeredAction: `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${checkoutRequest.id}' with reverse/void transaction '${reversedTransactionResponse.body.id}', Stripe chargeId: '${refundedCharge.id}', Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `value metadata: ${JSON.stringify(fetchValueResp.body.metadata)}`);
    }).timeout(15000);

    it("voids instead of reversing if original Transaction was pending", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 50
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: currency.code,
            lineItems: [{
                type: "product",
                productId: "pid",
                unitPrice: 1000
            }],
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            pending: true
        };

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");
        chai.assert.equal((stripeStep.charge as stripe.charges.ICharge).captured, false, `(stripeStep.charge as stripe.charges.ICharge).captured=${(stripeStep.charge as stripe.charges.ICharge).captured}`);

        let refundedCharge: stripe.charges.ICharge;
        const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);

        const chargeFromStripe = await lightrailStripe.charges.retrieve(stripeStep.chargeId, {stripe_account: stripeLiveMerchantConfig.stripeUserId});
        chai.assert.isNotNull(chargeFromStripe);

        refundedCharge = await lightrailStripe.charges.refund(stripeStep.chargeId, {reason: "fraudulent"}, {stripe_account: stripeLiveMerchantConfig.stripeUserId});

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateConnectWebhookEventMock("charge.refunded", refundedCharge));
        chai.assert.equal(webhookResp.statusCode, 204);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.equal(fetchTransactionChainResp.body[1].transactionType, "void", `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance, `fetchValueResp.body.balance=${fetchValueResp.body.balance}`);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
    }).timeout(8000);

    it("uses existing 'void' Transaction if original Transaction was pending and has been voided", async function () {
        if (!testStripeLive()) {
            this.skip();
            return;
        }

        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 50
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: currency.code,
            lineItems: [{
                type: "product",
                productId: "pid",
                unitPrice: 1000
            }],
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            pending: true
        };

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        const stripeChargeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");
        chai.assert.isString(stripeChargeStep.chargeId);
        chai.assert.isObject(stripeChargeStep.charge);
        chai.assert.isFalse((stripeChargeStep.charge as stripe.charges.ICharge).captured);

        const voidTransactionResponse = await testUtils.testAuthedRequest<Transaction>(restRouter, `/v2/transactions/${checkoutRequest.id}/void`, "POST", {id: generateId()});
        chai.assert.equal(voidTransactionResponse.statusCode, 201, `voidTransactionResponse.body=${JSON.stringify(voidTransactionResponse)}`);
        chai.assert.isNotNull(voidTransactionResponse.body.steps.find(step => step.rail === "stripe"));

        const stripeRefundStepFromVoid = <StripeTransactionStep>voidTransactionResponse.body.steps.find(step => step.rail === "stripe");
        chai.assert.isObject(stripeRefundStepFromVoid.charge);
        const refundFromVoid = <stripe.refunds.IRefund>stripeRefundStepFromVoid.charge;
        chai.assert.match(refundFromVoid.metadata.reason, /Being refunded as part of reverse transaction/);

        const refundedChargeMock = { // : stripe.charges.ICharge = {
            ...stripeChargeStep.charge,
            refunded: true,
            refunds: {
                data: [{reason: "fraudulent"} as stripe.refunds.IRefund],
                object: "",
                has_more: null,
                url: ""
            }
        } as stripe.charges.ICharge;
        const webhookEvent = generateConnectWebhookEventMock("charge.refunded", refundedChargeMock);
        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, webhookEvent);
        chai.assert.equal(webhookResp.statusCode, 204, `webhookResp.body=${JSON.stringify(webhookResp)}`);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.equal(fetchTransactionChainResp.body.length, 2, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
        chai.assert.isNotNull(fetchTransactionChainResp.body.find(txn => txn.transactionType === "reverse"), `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200, `fetchValueResp.body=${fetchValueResp.body}`);
        chai.assert.equal(fetchValueResp.body.balance, value.balance);
        chai.assert.equal(fetchValueResp.body.frozen, true, `fetchValueResp.body.frozen=${fetchValueResp.body.frozen}`);
        chai.assert.deepEqual(fetchValueResp.body.metadata, {stripeWebhookTriggeredAction: `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${checkoutRequest.id}' with reverse/void transaction '${voidTransactionResponse.body.id}', Stripe chargeId: '${stripeChargeStep.charge.id}', Stripe eventId: '${webhookEvent.id}', Stripe accountId: '${stripeLiveMerchantConfig.stripeUserId}'`}, `value metadata: ${JSON.stringify(fetchValueResp.body.metadata)}`);
    }).timeout(12000);
});

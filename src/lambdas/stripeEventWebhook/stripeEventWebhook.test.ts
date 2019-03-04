// create charge (connected account)
// refund - normal
// update refund -- fraudulent

// create charge (elevated risk)
// refund - normal

// ====================================
// Handling Stripe refunds with elevated risk level:
//     There are three levels of risk evaluation: normal, elevated, high. High risk transactions are blocked by default. Elevated risk transactions succeed, but if they are using Stripe Radar for Fraud Teams, it will be placed in a queue for manual review.
//     Should this endpoint listen for:
// - Any refunds (any reason) where the original charge event had `risk_level: elevated`?
//     - Refunds for any charge with `reason: fraudulent`?
//
//     `charge.refunded` (use `charge.refunds.data[##].reason == 'fraudulent'`)
//         `charge.refund.updated` - Occurs whenever a refund is updated, on selected payment methods.
//     `review.closed` - Occurs whenever a review is closed. The review’s reason field indicates why: approved, disputed, refunded, or refunded_as_fraud
// ====================================


import * as cassava from "cassava";
import * as cryptojs from "crypto-js";
import * as testUtils from "../../utils/testUtils";
import {generateId, testAuthedRequest} from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {installStripeEventWebhookRoute} from "./installStripeEventWebhookRoute";
import * as chai from "chai";
import {
    setStubsForStripeTests,
    stubCheckoutStripeCharge,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeTransactionStep, Transaction} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {createCurrency} from "../rest/currencies";
import {Currency} from "../../model/Currency";
import {stripeApiVersion} from "../../utils/stripeUtils/StripeConfig";
import {IObject} from "stripe";
import {CheckoutRequest} from "../../model/TransactionRequest";
import Stripe = require("stripe");
import IEvent = Stripe.events.IEvent;

describe("/v2/stripeEventWebhook", () => {
    const restRouter = new cassava.Router();
    const webhookEventRouter = new cassava.Router();

    const currency: Currency = {
        code: "CAD",
        name: "Antlers",
        symbol: "$",
        decimalPlaces: 2
    };
    const value1: Partial<Value> = {
        id: generateId(),
        currency: "CAD",
        balance: 50 // deliberately low so Stripe will always be charged
    };

    const checkoutReqBase: CheckoutRequest = {
        id: "",
        currency: currency.code,
        lineItems: [{
            type: "product",
            productId: "pid",
            unitPrice: 1000
        }],
        sources: [
            {
                rail: "lightrail",
                valueId: value1.id
            },
            {
                rail: "stripe",
                source: "tok_visa"
            }
        ]
    };

    before(async function () {
        await testUtils.resetDb();
        restRouter.route(testUtils.authRoute);
        installRestRoutes(restRouter);
        installStripeEventWebhookRoute(webhookEventRouter);

        await createCurrency(testUtils.defaultTestUser.auth, currency);

        const postValue1Resp = await testUtils.testAuthedRequest<Value>(restRouter, "/v2/values", "POST", value1);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("verifies event signatures", async () => {
        const webhookResp0 = await cassava.testing.testRouter(webhookEventRouter, cassava.testing.createTestProxyEvent("/v2/stripeEventWebhook", "POST", {body: JSON.stringify({food: "bard"})}));
        chai.assert.equal(webhookResp0.statusCode, 401);

        const webhookResp1 = await testSignedWebhookRequest(webhookEventRouter, {});
        chai.assert.equal(webhookResp1.statusCode, 204);
        const webhookResp2 = await testSignedWebhookRequest(webhookEventRouter, {foo: "bar"});
        chai.assert.equal(webhookResp2.statusCode, 204);
        const webhookResp3 = await testSignedWebhookRequest(webhookEventRouter, {
            foo: "bar",
            baz: [1, null, "2", undefined, {three: 0.4}]
        });
        chai.assert.equal(webhookResp3.statusCode, 204);
    });

    it("does nothing for vanilla refunds", async () => {
        const checkoutRequest: CheckoutRequest = {
            ...checkoutReqBase,
            id: generateId()
        };
        const [stripeResponse] = stubCheckoutStripeCharge(checkoutRequest, 1, 950);
        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(restRouter, "/v2/transactions/checkout", "POST", checkoutRequest);
        chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.isNotNull(checkoutResp.body.steps.find(step => step.rail === "stripe"));
        if (!testStripeLive()) {
            chai.assert.equal((checkoutResp.body.steps[1] as StripeTransactionStep).chargeId, stripeResponse.id);
            chai.assert.deepEqual((checkoutResp.body.steps[1] as StripeTransactionStep).charge, stripeResponse, `body.steps=${JSON.stringify(checkoutResp.body.steps)}`);
        }

        const stripeStep = <StripeTransactionStep>checkoutResp.body.steps.find(step => step.rail === "stripe");

        const webhookResp = await testSignedWebhookRequest(webhookEventRouter, generateWebhookEventMock("charge.refunded", stripeStep.charge));
        chai.assert.equal(webhookResp.statusCode, 204);

        const fetchValueResp = await testUtils.testAuthedRequest<Value>(restRouter, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(fetchValueResp.statusCode, 200);
        chai.assert.equal(fetchValueResp.body.balance, 0);

        const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(restRouter, `/v2/transactions/${checkoutRequest.id}/chain`, "GET");
        chai.assert.equal(fetchTransactionChainResp.body.length, 1);
    });
});


/**
 * See https://stripe.com/docs/webhooks/signatures#verify-manually for details about generating signed requests
 * @param router The webhook event router
 * @param body To test handling Stripe events, use the Event object structure: https://stripe.com/docs/api/events
 */
async function testSignedWebhookRequest(router: cassava.Router, body: any) {
    const lightrailStripeConfig = await getLightrailStripeModeConfig(true);
    const t = (Math.floor(Date.now() / 1000));
    const bodyString = JSON.stringify(body);
    const sig = cryptojs.HmacSHA256(`${t}.${bodyString}`, lightrailStripeConfig.connectWebhookSigningSecret);

    return await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/stripeEventWebhook", "POST", {
        headers: {
            "Stripe-Signature": `t=${t},v1=${sig},v0=${sig}`
        },
        body: bodyString
    }));
}

/**
 * Generates a dummy Stripe webhook event
 * @param eventType Possible Event types: https://stripe.com/docs/api/events/types
 * @param eventObject Events contain the object they describe (eg an event describing a charge contains the full Charge object)
 */
function generateWebhookEventMock(eventType: string, eventObject: IObject): IEvent {
    return {
        id: generateId(),
        type: eventType,
        object: "event",
        data: {
            object: eventObject
        },
        api_version: stripeApiVersion,
        created: Date.now(),
        livemode: false,
        pending_webhooks: 1
    };
}
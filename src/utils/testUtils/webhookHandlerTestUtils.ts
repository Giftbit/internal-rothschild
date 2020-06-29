import * as cassava from "cassava";
import * as chai from "chai";
import * as cryptojs from "crypto-js";
import * as stripe from "stripe";
import {createUSDCheckout, generateId, testAuthedRequest} from "../../utils/testUtils";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {stripeApiVersion} from "../../utils/stripeUtils/StripeConfig";
import {StripeTransactionStep, Transaction, TransactionType} from "../../model/Transaction";
import {Value} from "../../model/Value";
import {CheckoutRequest} from "../../model/TransactionRequest";
import {createRefund, retrieveCharge} from "../stripeUtils/stripeTransactions";
import * as testUtils from "./index";

/**
 * See https://stripe.com/docs/webhooks/signatures#verify-manually for details about generating signed requests
 * @param router The webhook event router
 * @param body To test handling Stripe events, use the Event object structure: https://stripe.com/docs/api/events
 */
export async function testSignedWebhookRequest(router: cassava.Router, body: any): Promise<cassava.ProxyResponse> {
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
 * Re 'account' property in return type: "For these events [i.e. Connect events], there will be an additional account attribute in the received Event object." - https://stripe.com/docs/api/events
 */
export function generateConnectWebhookEventMock(eventType: string, eventObject: stripe.IObject): stripe.events.IEvent & { account: string } {
    return {
        id: generateId(),
        type: eventType,
        account: testUtils.defaultTestUser.stripeAccountId,
        object: "event",
        data: {
            object: eventObject
        },
        api_version: stripeApiVersion,
        created: Date.now(),
        livemode: false,
        pending_webhooks: 1,
        request: {
            id: generateId()
        }
    };
}

export interface SetupForWebhookEventLightrailOptions {
    reversed?: boolean;
    captured?: boolean;
    voided?: boolean;
    initialCheckoutReq?: Partial<CheckoutRequest>;
}

export async function setupForWebhookEvent(router: cassava.Router, lightrailOptions?: SetupForWebhookEventLightrailOptions): Promise<{
    checkout: Transaction;
    valuesCharged: Value[];
    stripeStep: StripeTransactionStep;
    nextLightrailTransaction?: Transaction;
    nextStripeStep?: StripeTransactionStep;
    finalStateStripeCharge: stripe.charges.ICharge;
}> {
    let nextLightrailTransaction: Transaction;
    let nextStripeStep: StripeTransactionStep;

    // initial Lightrail transaction & value creation
    let checkoutProps: Partial<CheckoutRequest>;
    if (lightrailOptions && lightrailOptions.initialCheckoutReq) {
        checkoutProps = lightrailOptions.initialCheckoutReq;
    }
    const checkoutSetup = await createStripeUSDCheckout(router, checkoutProps);
    const valuesCharged: Value[] = checkoutSetup.valuesCharged;
    chai.assert.isObject(checkoutSetup.checkout);
    const checkout = checkoutSetup.checkout;
    chai.assert.isObject(checkoutSetup.checkout.steps.find(step => step.rail === "stripe"));
    const stripeStep = checkoutSetup.checkout.steps.find(step => step.rail === "stripe") as StripeTransactionStep;

    // if transaction should be reversed in Lightrail as well, do that (doesn't matter if it's already been refunded in Stripe)
    if (lightrailOptions && lightrailOptions.reversed) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
        const reverseResp = await testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutSetup.checkout.id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(reverseResp.statusCode, 201, `reverseResp.body=${JSON.stringify(reverseResp.body)}`);
        nextLightrailTransaction = reverseResp.body;

        chai.assert.isObject(nextLightrailTransaction.steps.find(step => step.rail === "stripe"));
        nextStripeStep = (nextLightrailTransaction.steps.find(step => step.rail === "stripe") as StripeTransactionStep);
    }

    // if original charge was pending and needs to be captured or voided, do that
    if (lightrailOptions && lightrailOptions.initialCheckoutReq && lightrailOptions.initialCheckoutReq.pending) {
        if (lightrailOptions.captured) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
            const captureResp = await testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/capture`, "POST", {id: generateId()});
            chai.assert.equal(captureResp.statusCode, 201, `captureResp.body=${JSON.stringify(captureResp.body)}`);
            nextLightrailTransaction = captureResp.body;
            chai.assert.isObject(nextLightrailTransaction.steps.find(step => step.rail === "stripe"));
            nextStripeStep = (nextLightrailTransaction.steps.find(step => step.rail === "stripe") as StripeTransactionStep);
        }
        if (lightrailOptions.voided) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
            const voidResp = await testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/void`, "POST", {id: generateId()});
            chai.assert.equal(voidResp.statusCode, 201, `captureResp.body=${JSON.stringify(voidResp.body)}`);
            nextLightrailTransaction = voidResp.body;
            chai.assert.isObject(nextLightrailTransaction.steps.find(step => step.rail === "stripe"));
            nextStripeStep = (nextLightrailTransaction.steps.find(step => step.rail === "stripe") as StripeTransactionStep);
        }
    }

    const finalStateStripeCharge = await retrieveCharge(stripeStep.chargeId, true, testUtils.defaultTestUser.stripeAccountId);

    return {
        checkout,
        valuesCharged,
        stripeStep,
        nextLightrailTransaction,
        nextStripeStep,
        finalStateStripeCharge
    };
}

async function createStripeUSDCheckout(router: cassava.Router, checkoutProps?: Partial<CheckoutRequest>): Promise<{ checkout: Transaction, valuesCharged: Value[] }> {
    const checkoutSetup = await createUSDCheckout(router, checkoutProps);
    const checkout = checkoutSetup.checkout;
    chai.assert.isNotNull(checkout.steps.find(step => step.rail === "stripe"));
    return {checkout, valuesCharged: checkoutSetup.valuesCharged};
}

export async function refundInStripe(stripeStep: StripeTransactionStep, refundReason?: string): Promise<stripe.charges.ICharge> {
    const chargeFromStripe = await retrieveCharge(stripeStep.chargeId, true, testUtils.defaultTestUser.stripeAccountId);
    chai.assert.isNotNull(chargeFromStripe);

    await createRefund({
        charge: stripeStep.chargeId,
        reason: refundReason || undefined
    }, true, testUtils.defaultTestUser.stripeAccountId);
    return await retrieveCharge(stripeStep.chargeId, true, testUtils.defaultTestUser.stripeAccountId);
}

export async function assertTransactionChainContainsTypes(router: cassava.Router, transactionId: string, expectedLengthOfChain: number, orderedExpectedTransactionTypes: TransactionType[]): Promise<Transaction[]> {
    const fetchTransactionChainResp = await testAuthedRequest<Transaction[]>(router, `/v2/transactions/${transactionId}/chain`, "GET");
    chai.assert.equal(fetchTransactionChainResp.statusCode, 200, `fetchTransactionChainResp.body=${fetchTransactionChainResp.body}`);
    chai.assert.equal(fetchTransactionChainResp.body.length, expectedLengthOfChain, `fetchTransactionChainResp.body=${JSON.stringify(fetchTransactionChainResp.body)}`);
    orderedExpectedTransactionTypes.forEach((txnType, index) => {
        chai.assert.equal(fetchTransactionChainResp.body[index].transactionType, txnType, `transaction types in chain: ${JSON.stringify(fetchTransactionChainResp.body.map(txn => txn.transactionType))}`);
    });
    return fetchTransactionChainResp.body;
}

export async function assertValuesRestoredAndFrozen(router: cassava.Router, originalValues: Value[], withMetadata?: boolean): Promise<void> {
    for (const v of originalValues) {
        const current = await testAuthedRequest<Value>(router, `/v2/values/${v.id}`, "GET");
        chai.assert.equal(current.statusCode, 200, `current value: ${JSON.stringify(current.body)}`);

        chai.assert.equal(current.body.balance, v.balance, `current value balance: ${current.body.balance}, original balance: ${v.balance}`);
        chai.assert.equal(current.body.frozen, true, `current value frozen state=${current.body.frozen}`);

        if (withMetadata) {
            chai.assert.isObject(current.body.metadata, `current value = ${current.body}`);
            chai.assert.isDefined(current.body.metadata["stripeWebhookTriggeredAction"], `current value metadata = ${current.body.metadata}`);
            chai.assert.match(current.body.metadata["stripeWebhookTriggeredAction"], /Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '(?!').*' with reverse\/void transaction '(?!').*', Stripe chargeId: '(?!').*', Stripe eventId: '(?!').*', Stripe accountId: '(?!').*'/, `value metadata: ${JSON.stringify(current.body.metadata)}`);
        }
    }
}

export function buildStripeFraudRefundedChargeMock(refundedCharge: stripe.charges.ICharge, refund: stripe.refunds.IRefund): stripe.charges.ICharge {
    return {
        ...refundedCharge,
        refunds: {
            object: "list",
            data: [{
                ...refund,
                reason: "fraudulent"
            }],
            has_more: false,
            total_count: 1,
            url: ""
        }
    };
}

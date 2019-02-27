import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";
import * as stripe from "stripe";
import {defaultTestUser} from "./index";
import * as stripeTransactions from "../stripeUtils/stripeTransactions";
import {
    CheckoutRequest,
    StripeTransactionParty,
    TransactionParty,
    TransferRequest
} from "../../model/TransactionRequest";
import {StripeRestError} from "../stripeUtils/StripeRestError";
import log = require("loglevel");

if (testStripeLive()) {
    require("dotenv").config();
}

const sinonSandbox = sinon.createSandbox();
let stripeChargeStub: sinon.SinonStub = null;
let stripeCaptureStub: sinon.SinonStub = null;
let stripeRefundStub: sinon.SinonStub = null;
let stripeUpdateChargeStub: sinon.SinonStub = null;

/**
 * Config from stripe test account//pass: integrationtesting+merchant@giftbit.com // x39Rlf4TH3pzn29hsb#
 */
export const stripeLiveMerchantConfig = {
    stripeUserId: "acct_1BOVE6CM9MOvFvZK",
    customer: {
        id: "cus_CP4Zd1Dddy4cOH",
        defaultCard: "card_1C0GSUCM9MOvFvZK8VB29qaz",
        nonDefaultCard: "card_1C0ZH9CM9MOvFvZKyZZc2X4Z"
    }
};

/**
 * We need platform keys too
 */
export const stripeLiveLightrailConfig = {
    secretKey: process.env["LIGHTRAIL_STRIPE_TEST_SECRET_KEY"] || "",
    webhookSigningSecret: process.env["LIGHTRAIL_STRIPE_TEST_WEBHOOK_SIGNING_SECRET"] || ""
};

const stripeStubbedConfig = {
    secretKey: "test",
    stripeUserId: "test"
};

export function setStubsForStripeTests() {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    const stubFetchFromS3ByEnvVar = sinonSandbox.stub(giftbitRoutes.secureConfig, "fetchFromS3ByEnvVar");
    stubFetchFromS3ByEnvVar
        .withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH")
        .resolves(testAssumeToken);
    stubFetchFromS3ByEnvVar
        .withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE")
        .resolves({
            email: "test@test.com",
            test: {
                clientId: "test-client-id",
                secretKey: testStripeLive() ? stripeLiveLightrailConfig.secretKey : stripeStubbedConfig.secretKey,
                publishableKey: "test-pk",
            },
            live: {}
        });

    const stubKvsGet = sinonSandbox.stub(kvsAccess, "kvsGet");
    stubKvsGet
        .withArgs(sinon.match(testAssumeToken.assumeToken), sinon.match("stripeAuth"), sinon.match.string)
        .resolves({
            token_type: "bearer",
            stripe_user_id: testStripeLive() ? stripeLiveMerchantConfig.stripeUserId : stripeStubbedConfig.stripeUserId,
        });
}

export function unsetStubsForStripeTests() {
    sinonSandbox.restore();
    stripeCaptureStub = null;
    stripeChargeStub = null;
    stripeRefundStub = null;
    stripeUpdateChargeStub = null;
}

export function testStripeLive(): boolean {
    return !!process.env["TEST_STRIPE_LIVE"];
}

export interface GenerateStripeChargeResponseOptions {
    transactionId: string;
    amount: number;
    currency: string;
    pending: boolean;
    sources?: TransactionParty[];
    metadata?: object;
    additionalProperties?: Partial<stripe.charges.ICharge>;
}

export function generateStripeChargeResponse(options: GenerateStripeChargeResponseOptions): stripe.charges.ICharge {
    const chargeId = (options.additionalProperties && options.additionalProperties.id) || "ch_" + getRandomChars(24);
    return {
        "id": chargeId,
        "object": "charge",
        "amount": options.amount,
        "amount_refunded": 0,
        "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
        "application_fee": null,
        "balance_transaction": "txn_" + getRandomChars(24),
        "captured": !options.pending,
        "created": Math.floor(Date.now() / 1000),
        "currency": options.currency.toLowerCase(),
        "customer": null,
        "description": null,
        "destination": null,
        "dispute": null,
        "failure_code": null,
        "failure_message": null,
        "fraud_details": {},
        "invoice": null,
        "livemode": false,
        "metadata": {
            // This metadata object is tightly coupled to how the code that creates the charge.
            ...options.metadata,
            "lightrailTransactionId": options.transactionId,
            "lightrailTransactionSources": JSON.stringify((options.sources || []).filter(source => source.rail === "lightrail")),
            "lightrailUserId": defaultTestUser.userId
        },
        "on_behalf_of": null,
        "order": null,
        "outcome": {
            "network_status": "approved_by_network",
            "reason": null,
            "risk_level": "normal",
            "seller_message": "Payment complete.",
            "type": "authorized"
        },
        "paid": true,
        "receipt_email": null,
        "receipt_number": null,
        "refunded": false,
        "refunds": {
            "object": "list",
            "data": [],
            "has_more": false,
            "total_count": 0,
            "url": `/v1/charges/${chargeId}/refunds`
        },
        "review": null,
        "shipping": null,
        "source": {
            "id": "card_" + getRandomChars(24),
            "object": "card",
            "address_city": null,
            "address_country": null,
            "address_line1": null,
            "address_line1_check": null,
            "address_line2": null,
            "address_state": null,
            "address_zip": null,
            "address_zip_check": null,
            "brand": "Visa",
            "country": "US",
            "customer": null,
            "cvc_check": null,
            "dynamic_last4": null,
            "exp_month": 7,
            "exp_year": 2019,
            "fingerprint": "LMHNXKv7kEbxUNL9",
            "funding": "credit",
            "last4": "4242",
            "metadata": {},
            "name": null,
            "tokenization_method": null
        },
        "source_transfer": null,
        "statement_descriptor": null,
        "status": "succeeded",
        "transfer_group": null,
        ...options.additionalProperties
    };
}

export interface GenerateStripeRefundResponseOptions {
    amount: number;
    currency: string;
    stripeChargeId: string;
    reason?: string;
    additionalProperties?: Partial<stripe.refunds.IRefund>;
}

export function generateStripeRefundResponse(options: GenerateStripeRefundResponseOptions): stripe.refunds.IRefund {
    const refundId = (options.additionalProperties && options.additionalProperties.id) || "re_" + getRandomChars(24);
    return {
        "id": refundId,
        "object": "refund",
        "amount": options.amount,
        "balance_transaction": "txn_" + getRandomChars(24),
        "charge": options.stripeChargeId,
        "created": Math.floor(Date.now() / 1000),
        "currency": options.currency.toLowerCase(),
        "metadata": {
            "reason": options.reason || "Refunded due to error on the Lightrail side"
        },
        "reason": null,
        "receipt_number": null,
        "source_transfer_reversal": null,
        "transfer_reversal": null,
        "status": "succeeded",
        ...options.additionalProperties
    } as any;
}

export interface GetStripeChargeStubOptions {
    transactionId: string;
    amount?: number;
    currency?: string;
    capture?: boolean;
    source?: string;
    customer?: string;
}

export function getStripeChargeStub(options: GetStripeChargeStubOptions): sinon.SinonStub {
    log.debug("stubbing stripe charge", options);
    const stub = stripeChargeStub || (stripeChargeStub = sinonSandbox.stub(stripeTransactions, "createCharge").callThrough());

    let param0Matcher = sinon.match.hasNested("metadata.lightrailTransactionId", options.transactionId);
    if (options.amount) {
        param0Matcher = param0Matcher.and(sinon.match.has("amount", options.amount));
    }
    if (options.currency) {
        param0Matcher = param0Matcher.and(sinon.match.has("currency", options.currency));
    }
    if (options.capture === true) {
        param0Matcher = param0Matcher.and(sinon.match(value => value.capture === true || value.capture == null));
    }
    if (options.capture === false) {
        param0Matcher = param0Matcher.and(sinon.match.has("capture", false));
    }
    if (options.source) {
        param0Matcher = param0Matcher.and(sinon.match.has("source", options.source));
    }
    if (options.customer) {
        param0Matcher = param0Matcher.and(sinon.match.has("customer", options.customer));
    }

    return stub.withArgs(
        param0Matcher,
        sinon.match(stripeStubbedConfig.secretKey),
        sinon.match(stripeStubbedConfig.stripeUserId),
        sinon.match.any
    );
}

export interface GetStripeCaptureStubOptions {
    stripeChargeId: string;
}

export function getStripeCaptureStub(options: GetStripeCaptureStubOptions): sinon.SinonStub {
    log.debug("stubbing stripe capture", options);
    const stub = stripeCaptureStub || (stripeCaptureStub = sinonSandbox.stub(stripeTransactions, "captureCharge").callThrough());

    return stub.withArgs(
        sinon.match.same(options.stripeChargeId),
        sinon.match.any,
        sinon.match(stripeStubbedConfig.secretKey),
        sinon.match(stripeStubbedConfig.stripeUserId)
    );
}

export interface GetStripeRefundStubOptions {
    amount: number;
    stripeChargeId: string;
}

export function getStripeRefundStub(options: GetStripeRefundStubOptions): sinon.SinonStub {
    log.debug("stubbing stripe refund", options);
    const stub = stripeRefundStub || (stripeRefundStub = sinonSandbox.stub(stripeTransactions, "createRefund").callThrough());

    return stub.withArgs(
        sinon.match.has("amount", options.amount)
            .and(sinon.match.has("charge", options.stripeChargeId)),
        sinon.match(stripeStubbedConfig.secretKey),
        sinon.match(stripeStubbedConfig.stripeUserId)
    );
}

export interface GetStripeUpdateChargeStubOptions {
    stripeChargeId: string;
}

export function getStripeUpdateChargeStub(options: GetStripeUpdateChargeStubOptions): sinon.SinonStub {
    log.debug("stubbing stripe update charge", options);
    const stub = stripeUpdateChargeStub || (stripeUpdateChargeStub = sinonSandbox.stub(stripeTransactions, "updateCharge").callThrough());

    return stub.withArgs(
        sinon.match.same(options.stripeChargeId),
        sinon.match.any,
        sinon.match(stripeStubbedConfig.secretKey),
        sinon.match(stripeStubbedConfig.stripeUserId)
    );
}

export function stubCheckoutStripeCharge(request: CheckoutRequest, stripeSourceIx: number, amount: number, additionalProperties?: Partial<stripe.charges.ICharge>): [stripe.charges.ICharge, sinon.SinonStub] {
    if (testStripeLive()) {
        return [null, null];
    }

    if (request.sources[stripeSourceIx].rail !== "stripe") {
        throw new Error(`Checkout request source ${stripeSourceIx} is not a stripe source.`);
    }
    const stripeSource = request.sources[stripeSourceIx] as StripeTransactionParty;

    const response = generateStripeChargeResponse({
            transactionId: request.id,
            amount: amount,
            currency: request.currency,
            pending: !!request.pending,
            sources: request.sources,
            metadata: request.metadata,
            additionalProperties
        }
    );

    const stub = getStripeChargeStub(
        {
            transactionId: request.id,
            amount: amount,
            currency: request.currency,
            capture: !request.pending,
            source: stripeSource.source,
            customer: stripeSource.customer
        })
        .resolves(response);

    return [response, stub];
}

export function stubTransferStripeCharge(request: TransferRequest, additionalProperties?: Partial<stripe.charges.ICharge>): [stripe.charges.ICharge, sinon.SinonStub] {
    if (testStripeLive()) {
        return [null, null];
    }

    if (request.source.rail !== "stripe") {
        throw new Error(`Checkout request source is not a stripe source.`);
    }

    let amount = request.amount;
    if (request.source.maxAmount && request.source.maxAmount < amount) {
        amount = request.source.maxAmount;
    }

    const response = generateStripeChargeResponse({
            transactionId: request.id,
            amount: amount,
            currency: request.currency,
            pending: !!request.pending,
            sources: [request.destination],
            metadata: request.metadata,
            additionalProperties
        }
    );

    const stub = getStripeChargeStub(
        {
            transactionId: request.id,
            amount: amount,
            currency: request.currency,
            capture: !request.pending,
            source: request.source.source,
            customer: request.source.customer
        })
        .resolves(response);

    return [response, stub];
}

export function stubCheckoutStripeError(request: CheckoutRequest, stripeSourceIx: number, error: StripeRestError): void {
    if (testStripeLive()) {
        return;
    }

    if (request.sources[stripeSourceIx].rail !== "stripe") {
        throw new Error(`Checkout request source ${stripeSourceIx} is not a stripe source.`);
    }
    const stripeSource = request.sources[stripeSourceIx] as StripeTransactionParty;

    getStripeChargeStub(
        {
            transactionId: request.id,
            currency: request.currency,
            capture: !request.pending,
            source: stripeSource.source,
            customer: stripeSource.customer
        })
        .rejects(error);
}

export function stubTransferStripeError(request: TransferRequest, error: StripeRestError): void {
    if (testStripeLive()) {
        return;
    }

    if (request.source.rail !== "stripe") {
        throw new Error(`Checkout request source is not a stripe source.`);
    }

    getStripeChargeStub(
        {
            transactionId: request.id,
            currency: request.currency,
            capture: !request.pending,
            source: request.source.source,
            customer: request.source.customer
        })
        .rejects(error);
}

export function stubStripeCapture(charge: stripe.charges.ICharge, amountCaptured?: number): [stripe.charges.ICharge, sinon.SinonStub] {
    if (testStripeLive()) {
        return [null, null];
    }

    const response: stripe.charges.ICharge = {
        ...charge,
        captured: true
    };
    if (amountCaptured) {
        if (amountCaptured > response.amount) {
            throw new Error("Can't capture more than the amount of the original charge.");
        }
        if (amountCaptured <= 0) {
            throw new Error("Can't capture <= 0.");
        }
        response.amount = amountCaptured;
    }

    const stub = getStripeCaptureStub(
        {
            stripeChargeId: charge.id
        })
        .resolves(response);

    return [response, stub];
}

export function stubStripeRefund(charge: stripe.charges.ICharge, additionalProperties?: Partial<stripe.refunds.IRefund>): [stripe.refunds.IRefund, sinon.SinonStub] {
    if (testStripeLive()) {
        return [null, null];
    }

    const response = generateStripeRefundResponse({
        amount: charge.amount,
        currency: charge.currency,
        stripeChargeId: charge.id,
        additionalProperties
    });

    const stub = getStripeRefundStub(
        {
            amount: charge.amount,
            stripeChargeId: charge.id
        })
        .resolves(response);

    // It's going to update as part of refund so stub them both.
    stubStripeUpdateCharge(charge);

    return [response, stub];
}

/**
 * If `updates` is defined then the updated charge is returned when the stub is created.  If not defined then
 * the updated charge is generated on the fly and can't be returned here.
 */
export function stubStripeUpdateCharge(charge: stripe.charges.ICharge, updates?: stripe.charges.IChargeUpdateOptions): [stripe.charges.ICharge | null, sinon.SinonStub] {
    if (testStripeLive()) {
        return [null, null];
    }

    if (updates) {
        const result = {
            ...charge,
            ...updates
        } as stripe.charges.ICharge;

        const stub = getStripeUpdateChargeStub(
            {
                stripeChargeId: charge.id
            })
            .resolves(result);
        return [result, stub];
    } else {
        const stub = getStripeUpdateChargeStub(
            {
                stripeChargeId: charge.id
            })
            .callsFake((chargeId, params) => Promise.resolve({
                ...charge,
                ...params
            }));
        return [null, stub];
    }
}

/**
 * Throw an error if Stripe is charged for this transaction request.
 */
export function stubNoStripeCharge(request: { id: string }): void {
    if (testStripeLive()) {
        return;
    }

    getStripeChargeStub({transactionId: request.id})
        .rejects(new Error("The Stripe stub should never be called in this test"));
}

function getRandomChars(length: number): string {
    let res = "";
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    for (let i = 0; i < length; i++)
        res += charset.charAt(Math.floor(Math.random() * charset.length));

    return res;
}

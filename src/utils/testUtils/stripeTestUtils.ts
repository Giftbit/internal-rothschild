import * as giftbitRoutes from "giftbit-cassava-routes";
import * as kvsAccess from "../kvsAccess";
import * as sinon from "sinon";
import * as stripe from "stripe";
import {defaultTestUser} from "./index";
import * as stripeTransactions from "../stripeUtils/stripeTransactions";
import {CheckoutRequest, StripeTransactionParty} from "../../model/TransactionRequest";

let sinonSandbox = sinon.createSandbox();

/**
 * Config from stripe test account//pass: integrationtesting+merchant@giftbit.com // x39Rlf4TH3pzn29hsb#
 */
export const stripeTestConfig = {
    secretKey: "sk_test_Fwb3uGyZsIb9eJ5ZQchNH5Em",
    stripeUserId: "acct_1BOVE6CM9MOvFvZK",
    customer: {
        id: "cus_CP4Zd1Dddy4cOH",
        defaultCard: "card_1C0GSUCM9MOvFvZK8VB29qaz",
        nonDefaultCard: "card_1C0ZH9CM9MOvFvZKyZZc2X4Z"
    }
};

const stripeStubbedConfig = {
    secretKey: "test",
    stripeUserId: "test"
};

export function setStubsForStripeTests() {
    const testAssumeToken: giftbitRoutes.secureConfig.AssumeScopeToken = {
        assumeToken: "this-is-an-assume-token"
    };

    let stubFetchFromS3ByEnvVar = sinonSandbox.stub(giftbitRoutes.secureConfig, "fetchFromS3ByEnvVar");
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_ASSUME_RETRIEVE_STRIPE_AUTH").resolves(testAssumeToken);
    stubFetchFromS3ByEnvVar.withArgs("SECURE_CONFIG_BUCKET", "SECURE_CONFIG_KEY_STRIPE").resolves({
        email: "test@test.com",
        test: {
            clientId: "test-client-id",
            secretKey: testStripeLive() ? stripeTestConfig.secretKey : stripeStubbedConfig.secretKey,
            publishableKey: "test-pk",
        },
        live: {}
    });

    let stubKvsGet = sinonSandbox.stub(kvsAccess, "kvsGet");
    stubKvsGet.withArgs(sinon.match(testAssumeToken.assumeToken), sinon.match("stripeAuth"), sinon.match.string).resolves({
        token_type: "bearer",
        stripe_user_id: testStripeLive() ? stripeTestConfig.stripeUserId : stripeStubbedConfig.stripeUserId,
    });
}

export function unsetStubsForStripeTests() {
    sinonSandbox.restore();
}

export function testStripeLive(): boolean {
    return !!process.env["TEST_STRIPE_LIVE"];
}

export interface GenerateStripeChargeResponseOptions {
    amount: number;
    currency: string;
    stripeChargeId?: string;
}

export function generateStripeChargeResponse(options: GenerateStripeChargeResponseOptions): stripe.charges.ICharge {
    const id = options.stripeChargeId || "ch_1CruzHG3cz9DRdBtUyQrTT7L";
    return {
        "id": id,
        "object": "charge",
        "amount": options.amount,
        "amount_refunded": 0,
        "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
        "application_fee": null,
        "balance_transaction": "txn_1CruzHG3cz9DRdBtQFbULLwg",
        "captured": true,
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
            "lightrailTransactionId": "CO-stripe-only",
            "lightrailTransactionSources": "[]",
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
            "url": `/v1/charges/${id}/refunds`
        },
        "review": null,
        "shipping": null,
        "source": {
            "id": "card_1CruzHG3cz9DRdBtBFFtS5hy",
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
        "transfer_group": null
    };
}

export function stubCheckoutStripeCharge(request: CheckoutRequest, stripeStepIx: number, amount: number): void {
    if (testStripeLive()) {
        return;
    }

    if (request.sources[stripeStepIx].rail !== "stripe") {
        throw new Error(`Checkout request source ${stripeStepIx} is not a stripe source.`);
    }
    const stripeSource = request.sources[stripeStepIx] as StripeTransactionParty;

    const stub = sinonSandbox.stub(stripeTransactions, "createCharge");
    stub.withArgs(
        sinon.match.has("amount", amount)
            .and(sinon.match.hasNested("metadata.lightrailTransactionId", request.id))
            .and(sinon.match.hasNested("source", stripeSource.source)),
        sinon.match(stripeStubbedConfig.secretKey),
        sinon.match(stripeStubbedConfig.stripeUserId),
        sinon.match.any
    ).resolves(generateStripeChargeResponse({
            amount: amount,
            currency: request.currency
        }
    ));
    stub.callThrough();
}

import * as cassava from "cassava";
import * as chai from "chai";
import {Value} from "../../../../model/Value";
import {StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {Currency} from "../../../../model/Currency";
import * as testUtils from "../../../../utils/testUtils";
import {
    setStubsForStripeTests,
    stubCheckoutStripeCharge,
    stubCheckoutStripeError,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import {installRestRoutes} from "../../installRestRoutes";
import {LineItem} from "../../../../model/LineItem";
import {StripeRestError} from "../../../../utils/stripeUtils/StripeRestError";
import * as stripe from "stripe";
import chaiExclude = require("chai-exclude");
import {CheckoutRequest} from "../../../../model/TransactionRequest";

chai.use(chaiExclude);

require("dotenv").config();

describe("handling fraudulent charges", () => {
    const router = new cassava.Router();

    const value: Partial<Value> = {
        id: "value-for-stripe-fraudcheck",
        currency: "CAD",
        balance: 100
    };
    const lineItems: LineItem[] = [
        {
            type: "product",
            productId: "xyz-123",
            unitPrice: 500
        }
    ];

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        const currency: Currency = {
            code: "CAD",
            name: "Monopoly Money",
            symbol: "$",
            decimalPlaces: 2
        };
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("does nothing if the charge succeeds but is flagged for review in Stripe", async () => {
        const request: CheckoutRequest = {
            id: "risk-elevated",
            sources: [
                {
                    rail: "stripe",
                    source: "tok_riskLevelElevated"
                }
            ],
            currency: "CAD",
            lineItems
        };

        stubCheckoutStripeCharge(request, 0, 500, {
            "outcome": {
                "network_status": "approved_by_network",
                "reason": null,
                "risk_level": "elevated",
                "seller_message": "Payment complete.",
                "type": "authorized"
            }
        });

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "stripe",
                chargeId: "",
                amount: -500,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            source: "tok_riskLevelElevated",
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.equal(((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge as stripe.charges.ICharge).outcome.risk_level, "elevated", `outcome=${JSON.stringify(((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge  as stripe.charges.ICharge).outcome, null, 4)}`);
    });

    it("fails with a clear error if the charge is blocked by Stripe (fraudulent)", async () => {
        const request: CheckoutRequest = {
            id: "chg-fraudulent",
            sources: [
                {
                    rail: "stripe",
                    source: "tok_chargeDeclinedFraudulent"
                }
            ],
            currency: "CAD",
            lineItems
        };
        const exampleStripeError = {
            "type": "StripeCardError",
            "stack": "Error: Your card was declined.\n    at Constructor._Error (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Function.StripeError.generate (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:55:12)\n    at IncomingMessage.<anonymous> (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/StripeResource.js:170:39)\n    at emitNone (events.js:110:20)\n    at IncomingMessage.emit (events.js:207:7)\n    at endReadableNT (_stream_readable.js:1059:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
            "rawType": "card_error",
            "code": "card_declined",
            "message": "Your card was declined.",
            "raw": {
                "charge": "ch_1CtgK6G3cz9DRdBtxMsEuwyJ",
                "code": "card_declined",
                "decline_code": "fraudulent",
                "doc_url": "https://stripe.com/docs/error-codes/card-declined",
                "message": "Your card was declined.",
                "type": "card_error",
                "headers": {
                    "server": "nginx",
                    "date": "Tue, 31 Jul 2018 00:51:37 GMT",
                    "content-type": "application/json",
                    "content-length": "264",
                    "connection": "close",
                    "access-control-allow-credentials": "true",
                    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                    "access-control-allow-origin": "*",
                    "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                    "access-control-max-age": "300",
                    "cache-control": "no-cache, no-store",
                    "idempotency-key": "chg-fraudulent-0",
                    "original-request": "req_RFKMkPMWnqUxDM",
                    "request-id": "req_O1p1HdaJnmI9X2",
                    "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                    "stripe-version": "2018-05-21",
                    "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                },
                "statusCode": 402,
                "requestId": "req_O1p1HdaJnmI9X2"
            },
            "headers": {
                "server": "nginx",
                "date": "Tue, 31 Jul 2018 00:51:37 GMT",
                "content-type": "application/json",
                "content-length": "264",
                "connection": "close",
                "access-control-allow-credentials": "true",
                "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                "access-control-allow-origin": "*",
                "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                "access-control-max-age": "300",
                "cache-control": "no-cache, no-store",
                "idempotency-key": "chg-fraudulent-0",
                "original-request": "req_RFKMkPMWnqUxDM",
                "request-id": "req_O1p1HdaJnmI9X2",
                "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                "stripe-version": "2018-05-21",
                "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
            },
            "requestId": "req_O1p1HdaJnmI9X2",
            "statusCode": 402
        };
        const exampleErrorResponse = new StripeRestError(422, "Error for tests: card blocked by Stripe for fraud", "StripeCardDeclined", exampleStripeError);
        stubCheckoutStripeError(request, 0, exampleErrorResponse);

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 422, `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
        chai.assert.equal((postCheckoutResp.body as any).messageCode, "StripeCardDeclined", `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
    });

    it("fails with a clear error if the charge is declined by the card provider (any reason)", async () => {
        const request: CheckoutRequest = {
            id: "chg-declined",
            sources: [
                {
                    rail: "stripe",
                    source: "tok_chargeDeclined"
                }
            ],
            currency: "CAD",
            lineItems
        };
        const exampleStripeError = {
            "type": "StripeCardError",
            "stack": "Error: Your card was declined.\n    at Constructor._Error (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Function.StripeError.generate (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:55:12)\n    at IncomingMessage.<anonymous> (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/StripeResource.js:170:39)\n    at emitNone (events.js:110:20)\n    at IncomingMessage.emit (events.js:207:7)\n    at endReadableNT (_stream_readable.js:1059:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
            "rawType": "card_error",
            "code": "card_declined",
            "message": "Your card was declined.",
            "raw": {
                "charge": "ch_1CtgK9G3cz9DRdBt59EOLyqU",
                "code": "card_declined",
                "decline_code": "generic_decline",
                "doc_url": "https://stripe.com/docs/error-codes/card-declined",
                "message": "Your card was declined.",
                "type": "card_error",
                "headers": {
                    "server": "nginx",
                    "date": "Tue, 31 Jul 2018 00:51:37 GMT",
                    "content-type": "application/json",
                    "content-length": "269",
                    "connection": "close",
                    "access-control-allow-credentials": "true",
                    "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                    "access-control-allow-origin": "*",
                    "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                    "access-control-max-age": "300",
                    "cache-control": "no-cache, no-store",
                    "idempotency-key": "chg-declined-0",
                    "original-request": "req_B4fG82qyKxQgUM",
                    "request-id": "req_mKMxsFVOSM9JXx",
                    "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                    "stripe-version": "2018-05-21",
                    "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                },
                "statusCode": 402,
                "requestId": "req_mKMxsFVOSM9JXx"
            },
            "headers": {
                "server": "nginx",
                "date": "Tue, 31 Jul 2018 00:51:37 GMT",
                "content-type": "application/json",
                "content-length": "269",
                "connection": "close",
                "access-control-allow-credentials": "true",
                "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                "access-control-allow-origin": "*",
                "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                "access-control-max-age": "300",
                "cache-control": "no-cache, no-store",
                "idempotency-key": "chg-declined-0",
                "original-request": "req_B4fG82qyKxQgUM",
                "request-id": "req_mKMxsFVOSM9JXx",
                "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                "stripe-version": "2018-05-21",
                "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
            },
            "requestId": "req_mKMxsFVOSM9JXx",
            "statusCode": 402
        };
        const exampleErrorResponse = new StripeRestError(422, "Error for tests: card declined by provider", "StripeCardDeclined", exampleStripeError);
        stubCheckoutStripeError(request, 0, exampleErrorResponse);

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 422, `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
        chai.assert.equal((postCheckoutResp.body as any).messageCode, "StripeCardDeclined", `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Value} from "../../../../model/Value";
import {StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {Currency} from "../../../../model/Currency";
import * as testUtils from "../../../../utils/testUtils";
import {
    setStubsForStripeTests,
    stripeEnvVarsPresent,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import {installRestRoutes} from "../../installRestRoutes";
import {LineItem} from "../../../../model/LineItem";
import chaiExclude = require("chai-exclude");


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
        if (!stripeEnvVarsPresent()) {
            this.skip();
            return;
        }

        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
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
        const request = {
            id: "elevated-risk",
            sources: [
                {
                    rail: "stripe",
                    source: "tok_riskLevelElevated"
                }
            ],
            currency: "CAD",
            lineItems
        };

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
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            source: "tok_riskLevelElevated",
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.equal((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge.outcome.risk_level, "elevated", `outcome=${JSON.stringify((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge.outcome, null, 4)}`);
    });

    it("fails with a clear error if the charge is blocked by Stripe (fraudulent)", async () => {
        const request = {
            id: "fraudulent-chg",
            sources: [
                {
                    rail: "stripe",
                    source: "tok_chargeDeclinedFraudulent"
                }
            ],
            currency: "CAD",
            lineItems
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 402, `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
        chai.assert.equal((postCheckoutResp.body as any).messageCode, "StripeCardDeclinedFraudulent", `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
    });

    it("fails with a clear error if the charge is declined by the card provider (any reason)", async () => {
        const request = {
            id: "declined-chg",
            sources: [
                {
                    rail: "stripe",
                    source: "tok_chargeDeclined"
                }
            ],
            currency: "CAD",
            lineItems
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 402, `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
        chai.assert.equal((postCheckoutResp.body as any).messageCode, "StripeCardDeclined", `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import {Value} from "../../../../model/Value";
import {StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {Currency} from "../../../../model/Currency";
import * as testUtils from "../../../../utils/testUtils";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../../utils/testUtils/stripeTestUtils";
import {installRestRoutes} from "../../installRestRoutes";
import {LineItem} from "../../../../model/LineItem";
import * as stripe from "stripe";
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";

chai.use(chaiExclude);

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

        const currency: Partial<Currency> = {
            code: "CAD",
            name: "Monopoly Money",
            symbol: "$",
            decimalPlaces: 2
        };
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        await setStubsForStripeTests();
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

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps as StripeTransactionStep[], [
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
        chai.assert.equal(((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge as stripe.charges.ICharge).outcome.risk_level, "elevated", `outcome=${JSON.stringify(((postCheckoutResp.body.steps[0] as StripeTransactionStep).charge as stripe.charges.ICharge).outcome, null, 4)}`);
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
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 409, `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
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
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 409, `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
        chai.assert.equal((postCheckoutResp.body as any).messageCode, "StripeCardDeclined", `resp=${JSON.stringify(postCheckoutResp, null, 4)}`);
    });
});

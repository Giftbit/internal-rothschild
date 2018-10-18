import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../../../utils/testUtils/index";
import {installRestRoutes} from "../../../installRestRoutes";
import {createCurrency} from "../../../currencies";
import * as sinon from "sinon";
import {Value} from "../../../../../model/Value";
import {
    InternalTransactionStep,
    LightrailTransactionStep,
    StripeTransactionStep,
    Transaction
} from "../../../../../model/Transaction";
import {CheckoutRequest, ReverseRequest} from "../../../../../model/TransactionRequest";
import {after} from "mocha";
import {
    setStubsForStripeTests,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../../../utils/testUtils/stripeTestUtils";
import * as stripeTransactions from "../../../../../utils/stripeUtils/stripeTransactions";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/reverse", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await setCodeCryptographySecrets();

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
        chai.assert.equal(currency.code, "USD");
        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    afterEach(() => {
        sinonSandbox.restore();
    });

    describe("reversing checkouts TESTING STRIPE FORMAT", () => {

        it("can reverse a checkout with balance and tok_visa", async () => {
            if (!testStripeLive()) {
                const mockCharge1 = require("./_mockChargeResult1.json");
                const mockCharge2 = require("./_mockChargeResult2.json");
                const mockRefund1 = require("./_mockRefundResult1.json");
                const mockRefund2 = require("./_mockRefundResult2.json");

                sinonSandbox.stub(stripeTransactions, "createCharge")
                    .withArgs(sinon.match({
                        amount: 50,
                    })).resolves(mockCharge1)
                    .withArgs(sinon.match({
                        amount: 99,
                    })).resolves(mockCharge2);

                sinonSandbox.stub(stripeTransactions, "createRefund")
                    .withArgs(sinon.match({
                        "amount": 50,
                        "chargeId": mockCharge1.id
                    })).resolves(mockRefund1)
                    .withArgs(sinon.match({
                        "amount": 99,
                        "chargeId": mockCharge2.id,
                    })).resolves(mockRefund2);
            }

            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 100
            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            // create checkout
            const checkout: CheckoutRequest = {
                id: generateId(),
                lineItems: [{
                    unitPrice: 250
                }],
                currency: "USD",
                sources: [
                    {
                        rail: "internal",
                        beforeLightrail: true,
                        balance: 1,
                        internalId: "id"
                    },
                    {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa",
                        maxAmount: 50
                    },
                    {
                        rail: "stripe",
                        source: "tok_visa",
                        maxAmount: 200
                    }
                ]
            };
            const postCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
            chai.assert.equal(postCheckout.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);
            chai.assert.equal((postCheckout.body.steps[0] as InternalTransactionStep).balanceChange, -1, `body=${JSON.stringify(postCheckout.body)}`);
            chai.assert.equal((postCheckout.body.steps[1] as LightrailTransactionStep).balanceChange, -100, `body=${JSON.stringify(postCheckout.body)}`);
            chai.assert.equal((postCheckout.body.steps[2] as StripeTransactionStep).amount, -50, `body=${JSON.stringify(postCheckout.body)}`);
            chai.assert.equal((postCheckout.body.steps[3] as StripeTransactionStep).amount, -99, `body=${JSON.stringify(postCheckout.body)}`);

            // lookup chain
            const getChain1 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${checkout.id}/chain`, "GET");
            chai.assert.equal(getChain1.body.length, 1);

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse);
            chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);
            verifyCheckoutReverseTotals(postCheckout.body, postReverse.body);
            chai.assert.isDefined(postReverse.body.steps.find(step => step.rail === "internal" && step.balanceChange === 1));
            chai.assert.isDefined(postReverse.body.steps.find(step => step.rail === "lightrail" && step.balanceChange === 100));
            chai.assert.isDefined(postReverse.body.steps.find(step => step.rail === "stripe" && step.amount === 50));
            chai.assert.isDefined(postReverse.body.steps.find(step => step.rail === "stripe" && step.amount === 99));

            // check value is same as before
            const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");

            // lookup chain2
            const getChain2 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${checkout.id}/chain`, "GET");
            chai.assert.equal(getChain2.body.length, 2);
        }).timeout(12000);
    });

    function verifyCheckoutReverseTotals(checkout: Transaction, reverse: Transaction): void {
        for (const key of Object.keys(checkout.totals)) {
            chai.assert.equal(reverse.totals[key], -checkout.totals[key]);
        }
    }

    // todo - test the transaction chain that's created from a reverse (look up db objects and ensure the correct values are there).
    // todo - test you can't reverse a reverse

});

import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../values";
import * as currencies from "../currencies";
import * as testUtils from "../../../testUtils";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {Currency} from "../../../model/Currency";

require("dotenv").config();

describe.only("split tender checkout with Stripe", () => {
    const router = new cassava.Router();

    const value: Partial<Value> = {
        id: "value-for-checkout-w-stripe",
        currency: "CAD",
        balance: 100
    };
    const source: string = "tok_visa";

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        currencies.installCurrenciesRest(router);

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
    });

    it.only("processes basic checkout with Stripe only", async () => {
        const request = {
            id: "checkout-with-stripe-only",
            sources: [
                {
                    rail: "stripe",
                    source: source
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 123
                }
            ],
            currency: "CAD"
        };

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);

        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subTotal: 123,
            tax: 0,
            discount: 0,
            payable: 123,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 123,
                quantity: 1,
                lineTotal: {
                    subtotal: 123,
                    taxable: 123,
                    tax: 0,
                    discount: 0,
                    payable: 123,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "stripe",
                chargeId: "",
                amount: 123,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[0], {
            rail: "stripe",
            source: "tok_visa",
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it.only("process basic split tender checkout", async () => {
        const request = {
            id: "checkout-with-stripe",
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: source
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "xyz-123",
                    unitPrice: 500
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.equal(postCheckoutResp.body.id, request.id);
        chai.assert.deepEqual(postCheckoutResp.body.totals, {
            subTotal: 500,
            tax: 0,
            discount: 0,
            payable: 500,
            remainder: 0
        }, `body.totals=${JSON.stringify(postCheckoutResp.body.totals)}`);
        chai.assert.deepEqual(postCheckoutResp.body.lineItems, [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 500,
                quantity: 1,
                lineTotal: {
                    subtotal: 500,
                    taxable: 500,
                    tax: 0,
                    discount: 0,
                    payable: 500,
                    remainder: 0
                }
            }
        ], `body.lineItems=${JSON.stringify(postCheckoutResp.body.lineItems)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.steps, [
            {
                rail: "lightrail",
                valueId: value.id,
                code: null,
                contactId: null,
                balanceBefore: 100,
                balanceAfter: 0,
                balanceChange: -100
            },
            {
                rail: "stripe",
                chargeId: "",
                amount: 400,
                charge: null
            }
        ], ["chargeId", "charge"], `body.steps=${JSON.stringify(postCheckoutResp.body.steps)}`);
        chai.assert.deepEqual(postCheckoutResp.body.paymentSources[0], {
            rail: "lightrail",
            valueId: value.id
        }, `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body.paymentSources[1], {
            rail: "stripe",
            source: "tok_visa",
            chargeId: "",
        }, "chargeId", `body.paymentSources=${JSON.stringify(postCheckoutResp.body.paymentSources)}`);

        // doing a deepEqual on the whole response body would be nice, but isn't great for changing parts of the response (eg if all instances of chargeId are ignored it's hard to tell if it's coming back in the right places)
        // chai.assert.deepEqualExcludingEvery(postCheckoutResp.body, {
        //     id: request.id,
        //     transactionType: "checkout",
        //     currency: "CAD",
        //     totals: {
        //         subTotal: 500,
        //         tax: 0,
        //         discount: 0,
        //         payable: 500,
        //         remainder: 0
        //     },
        //     lineItems: [
        //         {
        //             type: "product",
        //             productId: "xyz-123",
        //             unitPrice: 500,
        //             quantity: 1,
        //             lineTotal: {
        //                 subtotal: 500,
        //                 taxable: 500,
        //                 tax: 0,
        //                 discount: 0,
        //                 payable: 500,
        //                 remainder: 0
        //             }
        //         }
        //     ],
        //     steps: [
        //         {
        //             rail: "lightrail",
        //             valueId: value.id,
        //             code: null,
        //             contactId: null,
        //             balanceBefore: 100,
        //             balanceAfter: 0,
        //             balanceChange: -100
        //         },
        //         {
        //             rail: "stripe",
        //             chargeId: "",
        //             amount: 400,
        //             charge: null
        //         }
        //     ],
        //     paymentSources: [
        //         {
        //             rail: "lightrail",
        //             valueId: value.id
        //         },
        //         {
        //             rail: "stripe",
        //             source: "tok_visa",
        //             chargeId: "",
        //         }
        //     ],
        //     metadata: null,
        //     createdDate: null
        // }, ["createdDate", "chargeId", "charge"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["statusCode"], `body=${JSON.stringify(getCheckoutResp.body, null, 4)}`);
    });

    it.skip("updates the Stripe charge with LR transaction identifier");

    it.skip("processes split tender checkout with prepaid & discount LR value, plus Stripe");

    describe.skip("respects 'maxAmount' limit on Stripe source", async () => {
        // Should handle multiple cases:
        // - if LR value is sufficient, Stripe shouldn't even be assessed for its maxAmount
        // - if LR value is not sufficient and Stripe maxAmount is hit, throw a clear error
        // - if multiple Stripe sources are specified, use them in order and respect the maxAmount on each
        // These calculations happen during plan step calculation
    });

    it.skip("does not charge Stripe when Lightrail value is sufficient");

    it.skip("does not charge Stripe when 'simulate: true'");

    it.skip("creates a charge auth in Stripe when 'pending: true'");

    it.skip("captures Lightrail and Stripe charges together");

    it.skip("rolls back the Lightrail transaction when the Stripe transaction fails");

    it.skip("processes split tender checkout with two Stripe sources", () => {
        // check priority in sources request?
    });

});

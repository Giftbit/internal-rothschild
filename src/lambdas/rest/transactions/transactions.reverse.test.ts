import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../../utils/testUtils";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {CheckoutRequest, DebitRequest, ReverseRequest} from "../../../model/TransactionRequest";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe.only("/v2/transactions/transfer", () => {

    const router = new cassava.Router();

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
    });

    describe("reversing initialBalance", () => {
        it("can reverse initialBalance", async () => {
            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 100
            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            const initialBalanceTransaction: Transaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET").then(tx => tx.body[0]);
            console.log(JSON.stringify(initialBalanceTransaction));

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${initialBalanceTransaction.id}/reverse`, "POST", reverse);
            console.log(JSON.stringify(postReverse.body));
            chai.assert.equal(postReverse.statusCode, 201);

            // chai.assert.deepEqualExcluding(postReverse.body, {
            //     "id": "3aa6ba55-741d-4f3e-b",
            //     "transactionType": "reverse",
            //     "currency": "USD",
            //     "totals": null,
            //     "lineItems": null,
            //     "steps": [
            //         {
            //             "rail": "lightrail",
            //             "valueId": "c38f0e47-a03e-4a8a-9",
            //             "contactId": null,
            //             "code": null,
            //             "balanceBefore": 100,
            //             "balanceAfter": 0,
            //             "balanceChange": -100,
            //             "usesRemainingBefore": null,
            //             "usesRemainingAfter": null,
            //             "usesRemainingChange": 0
            //         }
            //     ],
            //     "paymentSources": null,
            //     "metadata": null,
            // }, ["createdDate"])
        });
    });

    describe("reversing debits", () => {
        it("can reverse a debit with balance", async () => {
            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balance: 100
            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            // create debit
            const debit: DebitRequest = {
                id: generateId(),
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 50,
                currency: "USD"
            };
            const postDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
            chai.assert.equal(postDebit.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
            console.log(JSON.stringify(postReverse));
            chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);

            // check value is same as before
            const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
        });

        it("can reverse a debit with balanceRule and usesRemaining", async () => {
            // create value
            const value: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                balanceRule: {
                    rule: "100",
                    explanation: "$1"
                },
                usesRemaining: 1,
                discount: true

            };
            const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(postValue.statusCode, 201);

            // create debit
            const checkout: CheckoutRequest = {
                id: generateId(),
                sources: [{
                    rail: "lightrail",
                    valueId: value.id
                }],
                lineItems: [{
                    productId: "123",
                    unitPrice: 100
                }],
                currency: "USD"
            };
            const postCheckout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout);
            chai.assert.equal(postCheckout.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);

            // create reverse
            const reverse: Partial<ReverseRequest> = {
                id: generateId()
            };
            const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse);
            console.log(JSON.stringify(postReverse));
            chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCheckout.body)}`);
            verifyCheckoutReverseTotals(postCheckout.body, postReverse.body);

            // check value is same as before
            const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
        });
    });

    function verifyCheckoutReverseTotals(checkout: Transaction, reverse: Transaction): void {
        for (const key of Object.keys(checkout.totals)) {
            console.log("key " + key + ". " + reverse.totals[key] + " == " + -checkout.totals[key]);
            chai.assert.equal(reverse.totals[key], -checkout.totals[key]);
        }
    }

});

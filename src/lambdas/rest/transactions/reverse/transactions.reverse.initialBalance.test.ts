import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils/index";
import {generateId} from "../../../../utils/testUtils";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {Transaction} from "../../../../model/Transaction";
import {ReverseRequest} from "../../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";

chai.use(chaiExclude);

describe("/v2/transactions/reverse - initialBalance", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
        chai.assert.equal(currency.code, "USD");
    });

    it("can reverse initialBalance transaction with balance", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // create reverse
        const initialBalanceTransactionId: string = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET").then(tx => tx.body[0].id);
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const simulate = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${initialBalanceTransactionId}/reverse`, "POST", {
            ...reverse,
            simulate: true
        });
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${initialBalanceTransactionId}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201);
        chai.assert.deepEqualExcluding(postReverse.body, {
            "id": reverse.id,
            "transactionType": "reverse",
            "currency": "USD",
            "createdDate": null,
            "totals": null,
            "lineItems": null,
            "tax": null,
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": value.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": 100,
                    "balanceAfter": 0,
                    "balanceChange": -100,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": null,
            "pending": false,
            "metadata": null,
            "createdBy": "default-test-user-TEST"
        }, ["createdDate"]);
        chai.assert.deepEqualExcluding(simulate.body, postReverse.body, ["simulated", "createdDate"]);
        chai.assert.isTrue(simulate.body.simulated);

        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValue.statusCode, 200);
        chai.assert.equal(getValue.body.balance, 0);
    });

    it("can reverse initialBalance transaction with balanceRule and usesRemaining", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "100",
                explanation: "$1"
            },
            usesRemaining: 1
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);
        chai.assert.equal(postValue.body.usesRemaining, 1);
        chai.assert.isNull(postValue.body.balance);

        // create reverse
        const initialBalanceTransactionId: string = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET").then(tx => tx.body[0].id);
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${initialBalanceTransactionId}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201);
        chai.assert.deepEqualExcluding(postReverse.body, {
            "id": reverse.id,
            "transactionType": "reverse",
            "currency": "USD",
            "createdDate": null,
            "totals": null,
            "lineItems": null,
            "tax": null,
            "steps": [
                {
                    "rail": "lightrail",
                    "valueId": value.id,
                    "contactId": null,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": null,
                    "usesRemainingBefore": 1,
                    "usesRemainingAfter": 0,
                    "usesRemainingChange": -1
                }
            ],
            "paymentSources": null,
            "pending": false,
            "metadata": null,
            "createdBy": "default-test-user-TEST"
        }, ["createdDate"]);

        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValue.statusCode, 200);
        chai.assert.equal(getValue.body.usesRemaining, 0);
        chai.assert.isNull(getValue.body.balance);
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {generateId} from "../../../../utils/testUtils";
import * as testUtils from "../../../../utils/testUtils/index";
import {Transaction} from "../../../../model/Transaction";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/reverse", () => {

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

    it("can't reverse a transaction twice", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // get initialBalance transaction
        const getInitialBalanceTransaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET");
        chai.assert.isNotNull(getInitialBalanceTransaction.body[0]);

        // reverse
        const postReverse1 = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${getInitialBalanceTransaction.body[0].id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(postReverse1.statusCode, 201);

        const postReverse2 = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${getInitialBalanceTransaction.body[0].id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(postReverse2.statusCode, 422);
    });

    it("can't reverse a reverse", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // get initialBalance transaction
        const getInitialBalanceTransaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET");
        chai.assert.isNotNull(getInitialBalanceTransaction.body[0]);

        // reverse
        const postReverseOfInitialBalanceTx = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${getInitialBalanceTransaction.body[0].id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(postReverseOfInitialBalanceTx.statusCode, 201);

        const postReverseOfReverseTx = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postReverseOfInitialBalanceTx.body.id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(postReverseOfReverseTx.statusCode, 422);
    });

    it("can't reverse a transaction that doesn't exist", async () => {
        // reverse
        const postReverseOfInitialBalanceTx = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${generateId()}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(postReverseOfInitialBalanceTx.statusCode, 404);
    });

    it("can't reverse with an existing transactionId", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // get initialBalance transaction
        const getInitialBalanceTransaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET");
        chai.assert.isNotNull(getInitialBalanceTransaction.body[0]);

        // reverse
        const postReverse1 = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/transactions/${getInitialBalanceTransaction.body[0].id}/reverse`, "POST", {id: getInitialBalanceTransaction.body[0].id});
        chai.assert.equal(postReverse1.statusCode, 409);
        chai.assert.equal(postReverse1.body.message, `A Lightrail transaction with transactionId '${getInitialBalanceTransaction.body[0].id}' already exists.`);
    });

    // todo - add simulate coverage.
});

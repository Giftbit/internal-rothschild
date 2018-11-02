import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {generateId} from "../../../../utils/testUtils";
import * as testUtils from "../../../../utils/testUtils/index";
import {Transaction} from "../../../../model/Transaction";
import {DebitRequest, ReverseRequest} from "../../../../model/TransactionRequest";
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

    describe("max id length checks", () => {
        const value: Partial<Value> = {
            id: generateId(64),
            currency: "USD",
            balance: 1,
        };
        const debit: Partial<DebitRequest> = {
            id: generateId(64),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 1,
            currency: "USD"
        };

        before(async function () {
            const createSourceValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(createSourceValue.statusCode, 201, JSON.stringify(createSourceValue));
            const createDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
            chai.assert.equal(createDebit.statusCode, 201, `body=${JSON.stringify(createDebit.body)}`);
        });

        it("cannot create reverse with id exceeding max length of 64 - returns 422", async () => {
            const reverse: Partial<ReverseRequest> = {
                id: generateId(65)
            };
            const createReverse = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
            chai.assert.equal(createReverse.statusCode, 422, `body=${JSON.stringify(createReverse.body)}`);
            chai.assert.include(createReverse.body.message, "requestBody.id does not meet maximum length of 64");
        });

        it("can create reverse with maximum id length", async () => {
            const reverse: Partial<ReverseRequest> = {
                id: generateId(64)
            };
            const createReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
            chai.assert.equal(createReverse.statusCode, 201, `body=${JSON.stringify(createReverse.body)}`);
        });
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Value} from "../../../model/Value";
import {createUSDCheckout, generateId, testAuthedRequest} from "../../../utils/testUtils";
import * as testUtils from "../../../utils/testUtils/index";
import {Transaction} from "../../../model/Transaction";
import {getDbTransaction} from "./transactions";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../utils/testUtils/stripeTestUtils";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/chain", () => {

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

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    let firstTransaction: Transaction;
    it("can get transaction chain on chain of size 1", async () => {
        // create value
        const value: Partial<Value> = {
            id: "a" + generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // get initialBalance transaction
        const getInitialBalanceTransaction = (await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET")).body[0];
        chai.assert.isNotNull(getInitialBalanceTransaction);
        firstTransaction = getInitialBalanceTransaction;

        // get chain
        const getChain = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${firstTransaction.id}/chain`, "GET");
        chai.assert.equal(getChain.body.length, 1);
        chai.assert.deepEqual(getChain.body[0], firstTransaction);
    });

    it("can check that rootTransactionId on first transaction is set to itself and next is null", async () => {
        chai.assert.isNotNull(firstTransaction.id, "this test depends on previous test. ensure transactionId was set");

        // get DbTransaction and check properties
        const dbTransaction = await getDbTransaction(testUtils.defaultTestUser.auth, firstTransaction.id);
        chai.assert.equal(dbTransaction.rootTransactionId, firstTransaction.id);
        chai.assert.isNull(dbTransaction.nextTransactionId);
    });

    let secondTransaction: Transaction;
    it("can get transaction chain with two transactions in a chain", async () => {
        chai.assert.isNotNull(firstTransaction.id, "this test depends on previous test. ensure transactionId was set");

        // reverse transaction to add to the chain
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${firstTransaction.id}/reverse`, "POST", {id: "b" + generateId()});
        chai.assert.equal(postReverse.statusCode, 201);
        secondTransaction = postReverse.body;

        // get chain
        const getChain = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${firstTransaction.id}/chain`, "GET");
        chai.assert.equal(getChain.body.length, 2);
        chai.assert.deepEqual(getChain.body[0], firstTransaction);
        chai.assert.deepEqual(getChain.body[1], postReverse.body);
    });

    it("can get transaction chain with three transactions in a chain", async () => {
        const checkoutSetup = await createUSDCheckout(router, {pending: true}, false);

        await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
        const captureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutSetup.checkout.id}/capture`, "POST", {id: generateId()});
        chai.assert.equal(captureResp.statusCode, 201, `captureResp.body=${JSON.stringify(captureResp.body)}`);

        await new Promise(resolve => setTimeout(resolve, 1000)); // manually delay creating the next transaction so it has a different createdDate
        const reverseResp = await testAuthedRequest<Transaction>(router, `/v2/transactions/${captureResp.body.id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(reverseResp.statusCode, 201, `reverseResp.body=${JSON.stringify(reverseResp.body)}`);

        // check that it gets the same chain for each transaction
        const checkoutChainResp = await testAuthedRequest<Transaction[]>(router, `/v2/transactions/${checkoutSetup.checkout.id}/chain`, "GET");
        const captureChainResp = await testAuthedRequest<Transaction[]>(router, `/v2/transactions/${captureResp.body.id}/chain`, "GET");
        const reverseChainResp = await testAuthedRequest<Transaction[]>(router, `/v2/transactions/${reverseResp.body.id}/chain`, "GET");
        chai.assert.deepEqual(checkoutChainResp.body, captureChainResp.body, `checkoutChain.body=${JSON.stringify(checkoutChainResp.body)}, captureChain.body=${JSON.stringify(captureChainResp.body)}`);
        chai.assert.deepEqual(checkoutChainResp.body, reverseChainResp.body, `checkoutChain.body=${JSON.stringify(checkoutChainResp.body)}, reverseChain.body=${JSON.stringify(reverseChainResp.body)}`);

        // check that transactions are in the right order
        const transactionTypesInChain: string[] = checkoutChainResp.body.map(t => t.transactionType);
        chai.assert.deepEqual(transactionTypesInChain, ["checkout", "capture", "reverse"], `transaction types in chain: '${transactionTypesInChain}'`);
    });

    it("can check that rootTransactionId and nextTransactionId on chain is correctly set", async () => {
        chai.assert.isNotNull(firstTransaction.id, "this test depends on previous test. ensure transactionId was set");
        chai.assert.isNotNull(secondTransaction.id, "this test depends on previous test. ensure transactionId was set");

        // get DbTransaction and check properties
        const firstDbTransaction = await getDbTransaction(testUtils.defaultTestUser.auth, firstTransaction.id);
        chai.assert.equal(firstDbTransaction.rootTransactionId, firstTransaction.id);
        chai.assert.equal(firstDbTransaction.nextTransactionId, secondTransaction.id);

        // get DbTransaction and check properties
        const secondDbTransaction = await getDbTransaction(testUtils.defaultTestUser.auth, secondTransaction.id);
        chai.assert.equal(secondDbTransaction.rootTransactionId, firstTransaction.id);
        chai.assert.isNull(secondDbTransaction.nextTransactionId);
    });
});

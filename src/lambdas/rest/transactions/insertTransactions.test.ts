import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {generateId} from "../../../utils/testUtils";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {createReverseTransactionPlan} from "./reverse/transactions.reverse";
import {TransactionPlan} from "./TransactionPlan";
import {insertTransaction} from "./insertTransactions";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import {getDbTransaction} from "./transactions";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("insertTransactions", () => {

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

    it("can insert transaction where plan.previousTransactionId is set and previous transaction.nextTransactionId is null", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // get initialBalance transaction
        const getInitialBalanceTransaction = (await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET")).body[0];
        chai.assert.isNotNull(getInitialBalanceTransaction);

        // get DbTransaction and check properties
        const dbTransaction = await getDbTransaction(testUtils.defaultTestUser.auth, getInitialBalanceTransaction.id);
        chai.assert.equal(dbTransaction.rootTransactionId, getInitialBalanceTransaction.id);
        chai.assert.isNull(dbTransaction.nextTransactionId);

        // create a valid transaction plan
        const reverseTransactionPlan: TransactionPlan = await createReverseTransactionPlan(testUtils.defaultTestUser.auth, {
            id: generateId()
        }, getInitialBalanceTransaction.id);

        // can insert the transaction
        const trx = await getKnexWrite();
        try {
            await insertTransaction(trx, testUtils.defaultTestUser.auth, reverseTransactionPlan);
        } catch (e) {
            chai.assert.fail(`This shouldn't have thrown an exception. e: ${JSON.stringify(e)}.`);
        }
    });

    it("can't insert transaction where plan.previousTransactionId is set and previous transaction.nextTransactionId has been updated by another transaction", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        // get initialBalance transaction
        const initialBalanceTransaction = (await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET")).body[0];
        chai.assert.isNotNull(initialBalanceTransaction);

        // create two reverse transaction plans
        const reverseTransactionPlan1: TransactionPlan = await createReverseTransactionPlan(testUtils.defaultTestUser.auth, {
                id: generateId()
            }, initialBalanceTransaction.id)
        ;
        const reverseTransactionPlan2: TransactionPlan = await createReverseTransactionPlan(testUtils.defaultTestUser.auth, {
            id: generateId()
        }, initialBalanceTransaction.id);

        // insert reverseTransactionPlan1 does not throw exception
        const trx = await getKnexWrite();
        await insertTransaction(trx, testUtils.defaultTestUser.auth, reverseTransactionPlan1);

        // get initial DbTransaction and check properties
        const initialDbT = await getDbTransaction(testUtils.defaultTestUser.auth, initialBalanceTransaction.id);
        chai.assert.equal(initialDbT.rootTransactionId, initialBalanceTransaction.id);
        chai.assert.equal(initialDbT.nextTransactionId, reverseTransactionPlan1.id);

        // insert reverseTransactionPlan2 throws exception
        try {
            await insertTransaction(trx, testUtils.defaultTestUser.auth, reverseTransactionPlan2);
            chai.assert.fail(`This shouldn't have happened because an exception should have been thrown.`);
        } catch (e) {
            chai.assert.isDefined(e, `Exception ${JSON.stringify(e)} was expected to be thrown.`);
        }
    });
});
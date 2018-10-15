import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils/index";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {LightrailTransactionStep, Transaction} from "../../../../model/Transaction";
import {CheckoutRequest, CreditRequest, ReverseRequest} from "../../../../model/TransactionRequest";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe.only("/v2/transactions/reverse", () => {

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

    it("can reverse a balance credit", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);
        chai.assert.equal(postValue.body.balance, 100);

        // create credit
        const credit: CreditRequest = {
            id: generateId(),
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 50,
            currency: "USD"
        };
        const postCredit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", credit);
        chai.assert.equal(postCredit.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);
        chai.assert.equal((postCredit.body.steps[0] as LightrailTransactionStep).balanceAfter, 150);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${credit.id}/reverse`, "POST", reverse);
        console.log(JSON.stringify(postReverse.body, null, 4));
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);

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

        // // create credit
        // const credit: CreditRequest = {
        //     id: generateId(),
        //     destination: {
        //         rail: "lightrail",
        //         valueId: value.id
        //     }
        // };
        // const postCredit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", credit);
        // chai.assert.equal(postCredit.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);
        // chai.assert.equal((postCredit.body.steps[0] as LightrailTransactionStep).balanceAfter, 150);
        //
        // // create reverse
        // const reverse: Partial<ReverseRequest> = {
        //     id: generateId()
        // };
        // const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${credit.id}/reverse`, "POST", reverse);
        // console.log(JSON.stringify(postReverse.body, null, 4));
        // chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);
        //
        // // check value is same as before
        // const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        // chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
    });
});

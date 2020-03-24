import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils/index";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {LightrailTransactionStep, Transaction} from "../../../../model/Transaction";
import {CreditRequest, DebitRequest, ReverseRequest} from "../../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../../utils/dbUtils";

chai.use(chaiExclude);

describe("/v2/transactions/reverse - credit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
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
        const simulate = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${credit.id}/reverse`, "POST", {
            ...reverse,
            simulate: true
        });
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${credit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);
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
                        "balanceBefore": 150,
                        "balanceAfter": 100,
                        "balanceChange": -50,
                        "usesRemainingBefore": null,
                        "usesRemainingAfter": null,
                        "usesRemainingChange": null
                    }
                ],
                "paymentSources": null,
                "pending": false,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            }, ["createdDate"]
        );
        chai.assert.deepEqualExcluding(simulate.body, postReverse.body, ["simulated", "createdDate"] /* sometimes this is off by a second since the tx is inserted in the following second after the simulate*/);
        chai.assert.isTrue(simulate.body.simulated);

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");
    });

    it("can reverse a credit with balanceRule and usesRemaining", async () => {
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

        // create credit
        const credit: CreditRequest = {
            id: generateId(),
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            currency: "USD",
            uses: 5
        };
        const postCredit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", credit);
        chai.assert.equal(postCredit.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);
        chai.assert.equal((postCredit.body.steps[0] as LightrailTransactionStep).usesRemainingAfter, 6);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${credit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postCredit.body)}`);
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
                        "balanceChange": 0,
                        "usesRemainingBefore": 6,
                        "usesRemainingAfter": 1,
                        "usesRemainingChange": -5
                    }
                ],
                "paymentSources": null,
                "pending": false,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            }, ["createdDate"]
        );

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");
    });

    it("can't reverse a credit if the value has been spent before the reverse is applied", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 0
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);
        chai.assert.equal(postValue.body.balance, 0);

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
        chai.assert.equal((postCredit.body.steps[0] as LightrailTransactionStep).balanceAfter, 50);

        // create debit
        const debit: DebitRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 1,
            currency: "USD"
        };
        const postDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
        chai.assert.equal(postDebit.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.equal((postDebit.body.steps[0] as LightrailTransactionStep).balanceAfter, 49);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${credit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 409, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.equal(postReverse.body.messageCode, "InsufficientBalance");

        // add credit for 2
        const credit2: CreditRequest = {
            id: generateId(),
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 2,
            currency: "USD"
        };
        const postCredit2 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", credit2);
        chai.assert.equal(postCredit2.statusCode, 201, `body=${JSON.stringify(postCredit2.body)}`);
        chai.assert.equal((postCredit2.body.steps[0] as LightrailTransactionStep).balanceAfter, 51);

        // now can do reverse
        const postReverseAgain = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${credit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverseAgain.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.equal((postReverseAgain.body.steps[0] as LightrailTransactionStep).balanceChange, -50);
        chai.assert.equal((postReverseAgain.body.steps[0] as LightrailTransactionStep).balanceAfter, 1);
    });
});

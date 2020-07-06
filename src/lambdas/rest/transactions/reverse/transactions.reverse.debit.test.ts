import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../../utils/testUtils/index";
import {installRestRoutes} from "../../installRestRoutes";
import {createCurrency} from "../../currencies";
import {Value} from "../../../../model/Value";
import {Transaction} from "../../../../model/Transaction";
import {CaptureRequest, DebitRequest, ReverseRequest} from "../../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../../utils/dbUtils";
import {LightrailTransactionStep} from "../../../../model/TransactionStep";

chai.use(chaiExclude);

describe("/v2/transactions/reverse - debit", () => {

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

    it("can reverse a balance debit", async () => {
        // create value
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);
        chai.assert.equal(postValue.body.balance, 100);

        // create debit
        const debit: DebitRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 75,
            currency: "USD"
        };
        const postDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
        chai.assert.equal(postDebit.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.equal((postDebit.body.steps[0] as LightrailTransactionStep).balanceAfter, 25);

        // create reverse
        const reverse: ReverseRequest = {
            id: generateId(),
            metadata: {
                "oh_look_a_cat": "🐈"
            }
        };
        const simulate = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", {
            ...reverse,
            simulate: true
        });
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.deepEqualExcluding(postReverse.body, {
                "id": reverse.id,
                "transactionType": "reverse",
                "currency": "USD",
                "createdDate": null,
                "totals": {
                    "remainder": 0
                },
                "lineItems": null,
                "tax": null,
                "steps": [
                    {
                        "rail": "lightrail",
                        "valueId": value.id,
                        "contactId": null,
                        "code": null,
                        "balanceBefore": 25,
                        "balanceAfter": 100,
                        "balanceChange": 75,
                        "usesRemainingBefore": null,
                        "usesRemainingAfter": null,
                        "usesRemainingChange": null
                    }
                ],
                "paymentSources": null,
                "pending": false,
                "metadata": {
                    "oh_look_a_cat": "🐈"
                },
                "createdBy": "default-test-user-TEST"
            }, ["createdDate"]
        );
        chai.assert.deepEqualExcluding(simulate.body, postReverse.body, ["simulated", "createdDate"]);
        chai.assert.isTrue(simulate.body.simulated);

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");
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
            usesRemaining: 5,
            discount: true

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
            currency: "USD",
            uses: 3
        };
        const postDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
        chai.assert.equal(postDebit.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.equal((postDebit.body.steps[0] as LightrailTransactionStep).usesRemainingAfter, 2);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.deepEqualExcluding(postReverse.body, {
                "id": reverse.id,
                "transactionType": "reverse",
                "currency": "USD",
                "createdDate": null,
                "totals": {
                    "remainder": 0
                },
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
                        "usesRemainingBefore": 2,
                        "usesRemainingAfter": 5,
                        "usesRemainingChange": 3
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

    it("can reverse a debit with remainder", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 50
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        const debit: DebitRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            currency: "USD",
            amount: 100,
            allowRemainder: true
        };
        const postDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
        chai.assert.equal(postDebit.statusCode, 201, `body=${JSON.stringify(postDebit.body)}`);
        chai.assert.equal(postDebit.body.totals.remainder, 50);

        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postReverse.body)}`);

        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");
    });

    it("can reverse a pending captured debit", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 50
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        const debitTx: DebitRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            currency: "USD",
            amount: 20,
            pending: true
        };
        const debitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debitTx);
        chai.assert.equal(debitRes.statusCode, 201, `body=${JSON.stringify(debitRes.body)}`);
        chai.assert.equal((debitRes.body.steps[0] as LightrailTransactionStep).balanceChange, -20);

        const captureTx: CaptureRequest = {
            id: generateId()
        };
        const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debitTx.id}/capture`, "POST", captureTx);
        chai.assert.equal(captureRes.statusCode, 201);

        const reverseTx: Partial<ReverseRequest> = {
            id: generateId()
        };
        const failedReverseRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debitTx.id}/reverse`, "POST", reverseTx);
        chai.assert.equal(failedReverseRes.statusCode, 409, `body=${JSON.stringify(failedReverseRes.body)}`);
        const reverseRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${captureTx.id}/reverse`, "POST", reverseTx);
        chai.assert.equal(reverseRes.statusCode, 201, `body=${JSON.stringify(reverseRes.body)}`);
        chai.assert.equal((reverseRes.body.steps[0] as LightrailTransactionStep).balanceChange, 20);

        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate");

        const chainRes = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${reverseTx.id}/chain`, "GET");
        chai.assert.sameDeepMembers(chainRes.body, [debitRes.body, captureRes.body, reverseRes.body]);
    });

    it("can reverse a debit with a canceled Value", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 50
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        const debitTx: DebitRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            currency: "USD",
            amount: 20
        };
        const debitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debitTx);
        chai.assert.equal(debitRes.statusCode, 201, `body=${JSON.stringify(debitRes.body)}`);

        const cancelResp = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {canceled: true});
        chai.assert.equal(cancelResp.statusCode, 200, `body=${JSON.stringify(cancelResp.body)}`);

        const reverseTx: Partial<ReverseRequest> = {
            id: generateId()
        };
        const reverseRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debitTx.id}/reverse`, "POST", reverseTx);
        chai.assert.equal(reverseRes.statusCode, 201, `body=${JSON.stringify(reverseRes.body)}`);
        chai.assert.equal((reverseRes.body.steps[0] as LightrailTransactionStep).balanceChange, 20);
    });

    it("can't reverse a debit with a frozen Value", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 50
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        const debitTx: DebitRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            currency: "USD",
            amount: 20
        };
        const debitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debitTx);
        chai.assert.equal(debitRes.statusCode, 201, `body=${JSON.stringify(debitRes.body)}`);

        const freezeResp = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {frozen: true});
        chai.assert.equal(freezeResp.statusCode, 200, `body=${JSON.stringify(freezeResp.body)}`);

        const reverseTx: Partial<ReverseRequest> = {
            id: generateId()
        };
        const reverseRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${debitTx.id}/reverse`, "POST", reverseTx);
        chai.assert.equal(reverseRes.statusCode, 409, `body=${JSON.stringify(reverseRes.body)}`);
        chai.assert.equal(reverseRes.body.messageCode, "ValueFrozen");
    });
});

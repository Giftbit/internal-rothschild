import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../../utils/testUtils/index";
import {generateId} from "../../../../../utils/testUtils/index";
import {installRestRoutes} from "../../../installRestRoutes";
import {createCurrency} from "../../../currencies";
import {Value} from "../../../../../model/Value";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../../../../model/Transaction";
import {ReverseRequest, TransferRequest} from "../../../../../model/TransactionRequest";
import {
    setStubsForStripeTests,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../../../utils/testUtils/stripeTestUtils";
import {after} from "mocha";
import * as sinon from "sinon";
import * as stripeTransactions from "../../../../../utils/stripeUtils/stripeTransactions";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/reverse - transfer", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

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

    afterEach(() => {
        sinonSandbox.restore();
    });


    it("can reverse a balance transfer from lightrail to lightrail", async () => {
        // create values
        const value1: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue1 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value1);
        chai.assert.equal(postValue1.statusCode, 201);
        chai.assert.equal(postValue1.body.balance, 100);

        const value2: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 20,
        };
        const postValue2 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value2);
        chai.assert.equal(postValue2.statusCode, 201);
        chai.assert.equal(postValue2.body.balance, 20);

        // create transfer
        const transfer: TransferRequest = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            destination: {
                rail: "lightrail",
                valueId: value2.id
            },
            amount: 75,
            currency: "USD"
        };
        const postTransfer = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", transfer);
        chai.assert.equal(postTransfer.statusCode, 201, `body=${JSON.stringify(postTransfer.body)}`);
        chai.assert.equal((postTransfer.body.steps[0] as LightrailTransactionStep).balanceAfter, 25);
        chai.assert.equal((postTransfer.body.steps[1] as LightrailTransactionStep).balanceAfter, 95);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transfer.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postTransfer.body)}`);
        chai.assert.deepEqualExcluding(postReverse.body as any, {
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
                        "valueId": value1.id,
                        "contactId": null,
                        "code": null,
                        "balanceBefore": 25,
                        "balanceAfter": 100,
                        "balanceChange": 75,
                        "usesRemainingBefore": null,
                        "usesRemainingAfter": null,
                        "usesRemainingChange": 0
                    },
                    {
                        "rail": "lightrail",
                        "valueId": value2.id,
                        "contactId": null,
                        "code": null,
                        "balanceBefore": 95,
                        "balanceAfter": 20,
                        "balanceChange": -75,
                        "usesRemainingBefore": null,
                        "usesRemainingAfter": null,
                        "usesRemainingChange": 0
                    }
                ],
                "paymentSources": null,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            }, ["createdDate"]
        );

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value2.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue2.body, getValue.body, "updatedDate")
    });

    it("can reverse a balance transfer from stripe to lightrail", async () => {
        if (!testStripeLive()) {
            const mockCharge1 = require("./_mockChargeResult1.json");
            const mockRefund1 = require("./_mockRefundResult1.json");

            sinonSandbox.stub(stripeTransactions, "createCharge")
                .withArgs(sinon.match({
                    amount: 75,
                })).resolves(mockCharge1);

            sinonSandbox.stub(stripeTransactions, "createRefund")
                .withArgs(sinon.match({
                    "amount": 75,
                    "chargeId": mockCharge1.id
                })).resolves(mockRefund1);
        }

        // create values
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(postValue.statusCode, 201);
        chai.assert.equal(postValue.body.balance, 100);

        // create transfer
        const transfer: TransferRequest = {
            id: generateId(),
            source: {
                rail: "stripe",
                source: "tok_visa"
            },
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 75,
            currency: "USD"
        };
        const postTransfer = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", transfer);
        chai.assert.equal(postTransfer.statusCode, 201, `body=${JSON.stringify(postTransfer.body)}`);
        chai.assert.equal((postTransfer.body.steps[0] as StripeTransactionStep).amount, -75);
        chai.assert.equal((postTransfer.body.steps[1] as LightrailTransactionStep).balanceAfter, 175);

        // create reverse
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transfer.id}/reverse`, "POST", reverse);
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postTransfer.body)}`);
        const stripeStep: StripeTransactionStep = postReverse.body.steps[1] as StripeTransactionStep;
        chai.assert.deepEqualExcluding(postReverse.body as any /* as any because source_transfer_reversal is not officially a property of IRefund */, {
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
                        "balanceBefore": 175,
                        "balanceAfter": 100,
                        "balanceChange": -75,
                        "usesRemainingBefore": null,
                        "usesRemainingAfter": null,
                        "usesRemainingChange": 0
                    },
                    {
                        "rail": "stripe",
                        "chargeId": stripeStep.chargeId,
                        "charge": {
                            "id": stripeStep.charge.id,
                            "object": "refund",
                            "amount": 75,
                            "balance_transaction": stripeStep.charge.balance_transaction,
                            "charge": stripeStep.chargeId,
                            "created": stripeStep.charge.created,
                            "currency": "usd",
                            "metadata": {
                                "reason": "not specified"
                            },
                            "reason": null,
                            "source_transfer_reversal": null,
                            "receipt_number": null,
                            "status": "succeeded"
                        },
                        "amount": 75
                    }
                ],
                "paymentSources": null,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            }, ["createdDate"]
        );

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.deepEqualExcluding(postValue.body, getValue.body, "updatedDate")
    }).timeout(15000);
});

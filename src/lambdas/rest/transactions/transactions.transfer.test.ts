import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../utils/testUtils";
import {Value} from "../../../model/Value";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../../model/Transaction";
import {Currency} from "../../../model/Currency";
import {installRestRoutes} from "../installRestRoutes";
import {
    setStubsForStripeTests,
    stripeEnvVarsPresent,
    unsetStubsForStripeTests
} from "../../../utils/testUtils/stripeTestUtils";
import {createCurrency} from "../currencies";
import {getCreatedBy} from "../../../utils/createdBy";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/transfer", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await setCodeCryptographySecrets();

        const postCurrencyResp = await createCurrency(defaultTestUser.auth, currency);
        chai.assert.equal(postCurrencyResp.code, "CAD", `currencyResp=${JSON.stringify(postCurrencyResp)}`);

        const postValue1Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueCad1);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);

        const postValue2Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueCad2);
        chai.assert.equal(postValue2Resp.statusCode, 201, `body=${JSON.stringify(postValue2Resp.body)}`);

        const postValue3Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueCadForStripeTests);
        chai.assert.equal(postValue3Resp.statusCode, 201, `body=${JSON.stringify(postValue3Resp.body)}`);
    });

    const currency: Currency = {
        code: "CAD",
        name: "Beaver pelts",
        symbol: "$",
        decimalPlaces: 2
    };

    const valueCad1: Partial<Value> = {
        id: "v-transfer-1",
        currency: "CAD",
        balance: 1500
    };

    const valueCad2: Partial<Value> = {
        id: "v-transfer-2",
        currency: "CAD",
        balance: 2500
    };

    const valueUsd: Partial<Value> = {
        id: "v-transfer-3",
        currency: "USD",
        balance: 3500
    };

    const valueCadForStripeTests: Partial<Value> = {
        id: "v-transfer-stripe",
        currency: "CAD",
    };

    it("can transfer between valueIds", async () => {
        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-1",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: "transfer-1",
            transactionType: "transfer",
            totals: {
                remainder: 0
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad1.id) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueCad1.id,
            code: null,
            contactId: null,
            balanceBefore: 1500,
            balanceAfter: 500,
            balanceChange: -1000
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2.id) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueCad2.id,
            code: null,
            contactId: null,
            balanceBefore: 2500,
            balanceAfter: 3500,
            balanceChange: 1000
        });

        const getValue1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad1.id}`, "GET");
        chai.assert.equal(getValue1Resp.statusCode, 200, `body=${JSON.stringify(getValue1Resp.body)}`);
        chai.assert.equal(getValue1Resp.body.balance, 500);

        const getValue2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2.id}`, "GET");
        chai.assert.equal(getValue2Resp.statusCode, 200, `body=${JSON.stringify(getValue2Resp.body)}`);
        chai.assert.equal(getValue2Resp.body.balance, 3500);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer-1", "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, "statusCode");
    });

    it("can transfer from secure code to valueId", async () => {
        const basicValue = {
            id: generateId(),
            currency: "CAD",
            balance: 100
        };
        const valueSecretCode = {
            id: generateId(),
            code: `${generateId()}-SECRET`,
            currency: "CAD",
            balance: 100
        };

        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", basicValue);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueSecretCode);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const requestFromSecret = {
            id: generateId(),
            source: {
                rail: "lightrail",
                code: valueSecretCode.code
            },
            destination: {
                rail: "lightrail",
                valueId: basicValue.id
            },
            amount: 100,
            currency: "CAD"
        };

        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", requestFromSecret);
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: requestFromSecret.id,
            transactionType: "transfer",
            totals: {
                remainder: 0
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueSecretCode.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueSecretCode.id,
            code: "…CRET",
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueSecretCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 0);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 200);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestFromSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, "statusCode");
    });

    it("can transfer from valueId to secure code", async () => {
        const basicValue = {
            id: generateId(),
            currency: "CAD",
            balance: 100
        };
        const valueSecretCode = {
            id: generateId(),
            code: `${generateId()}-SECRET`,
            currency: "CAD",
            balance: 100
        };

        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", basicValue);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueSecretCode);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const requestToSecret = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: basicValue.id
            },
            destination: {
                rail: "lightrail",
                code: valueSecretCode.code
            },
            amount: 100,
            currency: "CAD"
        };

        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", requestToSecret);
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: requestToSecret.id,
            transactionType: "transfer",
            totals: {
                remainder: 0
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueSecretCode.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueSecretCode.id,
            code: "…CRET",
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueSecretCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 200);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 0);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestToSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, "statusCode");
    });

    it("can transfer from generic code to valueId", async () => {
        const basicValue = {
            id: generateId(),
            currency: "CAD",
            balance: 100
        };
        const valueGenericCode = {
            id: generateId(),
            code: `${generateId()}-GENERIC`,
            currency: "CAD",
            balance: 100,
            isGenericCode: true
        };

        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", basicValue);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueGenericCode);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const requestFromSecret = {
            id: generateId(),
            source: {
                rail: "lightrail",
                code: valueGenericCode.code
            },
            destination: {
                rail: "lightrail",
                valueId: basicValue.id
            },
            amount: 100,
            currency: "CAD"
        };

        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", requestFromSecret);
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: requestFromSecret.id,
            transactionType: "transfer",
            totals: {
                remainder: 0
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueGenericCode.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueGenericCode.id,
            code: valueGenericCode.code,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueGenericCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 0);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 200);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestFromSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, "statusCode");
    });

    it("can transfer from valueId to generic code", async () => {
        const basicValue = {
            id: generateId(),
            currency: "CAD",
            balance: 100
        };
        const valueGenericCode = {
            id: generateId(),
            code: `${generateId()}-SECRET`,
            currency: "CAD",
            balance: 100,
            isGenericCode: true
        };

        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", basicValue);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueGenericCode);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const requestToSecret = {
            id: generateId(),
            source: {
                rail: "lightrail",
                valueId: basicValue.id
            },
            destination: {
                rail: "lightrail",
                code: valueGenericCode.code
            },
            amount: 100,
            currency: "CAD"
        };

        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", requestToSecret);
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: requestToSecret.id,
            transactionType: "transfer",
            totals: {
                remainder: 0
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueGenericCode.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueGenericCode.id,
            code: valueGenericCode.code,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueGenericCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 200);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 0);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestToSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, "statusCode");
    });

    it("409s on reusing an id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-1",    // same as above
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 15,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a transfer between valueIds", async () => {
        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-2",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 500,
            currency: "CAD",
            simulate: true
        });
        const validObject: Transaction = {
            id: "transfer-2",
            transactionType: "transfer",
            totals: {
                remainder: 0
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        };
        chai.assert.equal(postTransferResp.statusCode, 200, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, validObject, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad1.id) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueCad1.id,
            code: null,
            contactId: null,
            balanceBefore: 500,
            balanceAfter: 0,
            balanceChange: -500
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2.id) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueCad2.id,
            code: null,
            contactId: null,
            balanceBefore: 3500,
            balanceAfter: 4000,
            balanceChange: 500
        });

        const getValue1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad1.id}`, "GET");
        chai.assert.equal(getValue1Resp.statusCode, 200, `body=${JSON.stringify(getValue1Resp.body)}`);
        chai.assert.equal(getValue1Resp.body.balance, 500, "value did not actually change");

        const getValue2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2.id}`, "GET");
        chai.assert.equal(getValue2Resp.statusCode, 200, `body=${JSON.stringify(getValue2Resp.body)}`);
        chai.assert.equal(getValue2Resp.body.balance, 3500, "value did not actually change");
    });

    it("can transfer between valueIds with allowRemainder", async () => {
        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-3",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 7500,
            currency: "CAD",
            allowRemainder: true
        });
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: "transfer-3",
            transactionType: "transfer",
            totals: {
                remainder: 7500 - 500
            },
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
            createdBy: getCreatedBy(defaultTestUser.auth)
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad1.id) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueCad1.id,
            code: null,
            contactId: null,
            balanceBefore: 500,
            balanceAfter: 0,
            balanceChange: -500
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2.id) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueCad2.id,
            code: null,
            contactId: null,
            balanceBefore: 3500,
            balanceAfter: 4000,
            balanceChange: 500
        });

        const getValue1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad1.id}`, "GET");
        chai.assert.equal(getValue1Resp.statusCode, 200, `body=${JSON.stringify(getValue1Resp.body)}`);
        chai.assert.equal(getValue1Resp.body.balance, 0);

        const getValue2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2.id}`, "GET");
        chai.assert.equal(getValue2Resp.statusCode, 200, `body=${JSON.stringify(getValue2Resp.body)}`);
        chai.assert.equal(getValue2Resp.body.balance, 4000);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer-3", "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, "statusCode");
    });

    it("409s transferring between valueIds where the source has insufficient balance", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-4",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 2000,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InsufficientBalance");
    });

    it("409s transferring between valueIds in the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-5",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 1,
            currency: "XXX"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s transferring from an invalid valueId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-6",
            source: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s transferring to an invalid valueId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-7",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s transferring from a valueId in the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-8",
            source: {
                rail: "lightrail",
                valueId: valueUsd.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s transferring to a valueId in the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-9",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueUsd.id
            },
            amount: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("422s transferring without an id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s transferring with an invalid id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: 123,
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad2.id
            },
            amount: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    describe("stripe transfers", () => {
        before(function () {
            if (!stripeEnvVarsPresent()) {
                this.skip();
                return;
            }
            setStubsForStripeTests();
        });

        after(() => {
            unsetStubsForStripeTests();
        });

        it("can transfer from Stripe to Lightrail", async () => {
            const request = {
                id: "TR-stripe-1",
                source: {
                    rail: "stripe",
                    source: "tok_visa"
                },
                destination: {
                    rail: "lightrail",
                    valueId: valueCadForStripeTests.id
                },
                amount: 1000,
                currency: "CAD"
            };

            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
            chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
            chai.assert.deepEqualExcluding(postTransferResp.body, {
                id: request.id,
                transactionType: "transfer",
                totals: {
                    remainder: 0
                },
                currency: "CAD",
                lineItems: null,
                steps: null,
                paymentSources: null,
                metadata: null,
                createdDate: null,
                createdBy: getCreatedBy(defaultTestUser.auth)
            }, ["steps", "createdDate"]);
            chai.assert.lengthOf(postTransferResp.body.steps, 2);
            chai.assert.equal(postTransferResp.body.steps[0].rail, "stripe");

            const sourceStep = postTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe") as StripeTransactionStep;
            chai.assert.deepEqualExcluding(sourceStep, {
                rail: "stripe",
                amount: -1000
            }, ["chargeId", "charge"]);
            chai.assert.isNotNull(sourceStep.chargeId);
            chai.assert.isNotNull(sourceStep.charge);
            chai.assert.equal(sourceStep.charge.amount, 1000);
            chai.assert.deepEqual(sourceStep.charge.metadata, {
                "lightrailTransactionId": request.id,
                "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"v-transfer-stripe\"}]",
                "lightrailUserId": defaultTestUser.auth.userId
            }, JSON.stringify(sourceStep.charge.metadata));

            const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCadForStripeTests.id) as LightrailTransactionStep;
            chai.assert.deepEqual(destStep, {
                rail: "lightrail",
                valueId: valueCadForStripeTests.id,
                code: null,
                contactId: null,
                balanceBefore: 0,
                balanceAfter: 1000,
                balanceChange: 1000
            });

            const getValue3Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCadForStripeTests.id}`, "GET");
            chai.assert.equal(getValue3Resp.statusCode, 200, `body=${JSON.stringify(getValue3Resp.body)}`);
            chai.assert.equal(getValue3Resp.body.balance, 1000);

            const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
            chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
            chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, ["statusCode", "steps"]);

            const sourceStepFromGet = getTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe");
            chai.assert.deepEqual(sourceStepFromGet, sourceStep);

            const destStepFromGet = getTransferResp.body.steps.find((s: LightrailTransactionStep) => s.rail === "lightrail");
            chai.assert.deepEqual(destStepFromGet, destStep);

            const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
            const stripeChargeId = (postTransferResp.body.steps.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
            const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
            });
            chai.assert.deepEqual(stripeCharge, sourceStep.charge);
        });

        it("422s transferring a negative amount from Stripe", async () => {
            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
                id: "TR-stripe-2",
                source: {
                    rail: "stripe",
                    source: "tok_visa"
                },
                destination: {
                    rail: "lightrail",
                    valueId: valueCadForStripeTests.id
                },
                amount: -1000,
                currency: "CAD"
            });
            chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        it("respects maxAmount on Stripe source with allowRemainder", async () => {
            const request = {
                id: "TR-stripe-3",
                source: {
                    rail: "stripe",
                    source: "tok_visa",
                    maxAmount: 900
                },
                destination: {
                    rail: "lightrail",
                    valueId: valueCadForStripeTests.id
                },
                amount: 1000,
                currency: "CAD",
                allowRemainder: true
            };

            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
            chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
            chai.assert.deepEqualExcluding(postTransferResp.body, {
                id: request.id,
                transactionType: "transfer",
                totals: {
                    remainder: 100
                },
                currency: "CAD",
                lineItems: null,
                steps: null,
                paymentSources: null,
                metadata: null,
                createdDate: null,
                createdBy: getCreatedBy(defaultTestUser.auth)
            }, ["steps", "createdDate"]);
            chai.assert.lengthOf(postTransferResp.body.steps, 2);
            chai.assert.equal(postTransferResp.body.steps[0].rail, "stripe");

            const sourceStep = postTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe") as StripeTransactionStep;
            chai.assert.deepEqualExcluding(sourceStep, {
                rail: "stripe",
                amount: -900
            }, ["chargeId", "charge"]);
            chai.assert.isNotNull(sourceStep.chargeId);
            chai.assert.isNotNull(sourceStep.charge);
            chai.assert.equal(sourceStep.charge.amount, 900);
            chai.assert.deepEqual(sourceStep.charge.metadata, {
                "lightrailTransactionId": request.id,
                "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"v-transfer-stripe\"}]",
                "lightrailUserId": defaultTestUser.auth.userId
            });

            const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCadForStripeTests.id) as LightrailTransactionStep;
            chai.assert.deepEqual(destStep, {
                rail: "lightrail",
                valueId: valueCadForStripeTests.id,
                code: null,
                contactId: null,
                balanceBefore: 1000,
                balanceAfter: 1900,
                balanceChange: 900
            });

            const getValue3Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCadForStripeTests.id}`, "GET");
            chai.assert.equal(getValue3Resp.statusCode, 200, `body=${JSON.stringify(getValue3Resp.body)}`);
            chai.assert.equal(getValue3Resp.body.balance, 1900);

            const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
            chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
            chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, ["statusCode", "steps"]);

            const sourceStepFromGet = getTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe");
            chai.assert.deepEqual(sourceStepFromGet, sourceStep);

            const destStepFromGet = getTransferResp.body.steps.find((s: LightrailTransactionStep) => s.rail === "lightrail");
            chai.assert.deepEqual(destStepFromGet, destStep);

            const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
            const stripeChargeId = (postTransferResp.body.steps.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
            const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
            });
            chai.assert.deepEqual(stripeCharge, sourceStep.charge);
        });

        it("409s transferring from Stripe with insufficient maxAmount and allowRemainder=false", async () => {
            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
                id: "TR-stripe-4",
                source: {
                    rail: "stripe",
                    source: "tok_visa",
                    maxAmount: 900
                },
                destination: {
                    rail: "lightrail",
                    valueId: valueCadForStripeTests.id
                },
                amount: 1000,
                currency: "CAD",
            });
            chai.assert.equal(postTransferResp.statusCode, 409, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        it("422s transferring to Stripe from Lightrail", async () => {
            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
                id: "TR-stripe-5",
                source: {
                    rail: "lightrail",
                    valueId: valueCadForStripeTests.id
                },
                destination: {
                    rail: "stripe",
                    source: "tok_visa",
                },
                amount: 1000,
                currency: "CAD",
            });
            chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        describe("respects Stripe minimum of $0.50", () => {
            before(async function () {
                if (!stripeEnvVarsPresent()) {
                    this.skip();
                    return;
                }
            });

            it("fails the transfer by default", async () => {
                const request = {
                    id: "TR-insuff-stripe-amount",
                    currency: "CAD",
                    amount: 25,
                    source: {
                        rail: "stripe",
                        source: "tok_visa",
                    },
                    destination: {
                        rail: "lightrail",
                        valueId: valueCadForStripeTests.id
                    }
                };
                const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
                chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
                chai.assert.isNotNull((postTransferResp.body as any).messageCode, `body=${JSON.stringify(postTransferResp.body)}`);
                chai.assert.equal((postTransferResp.body as any).messageCode, "StripeAmountTooSmall", `body=${JSON.stringify(postTransferResp.body)}`);
            });
        });
    });
});

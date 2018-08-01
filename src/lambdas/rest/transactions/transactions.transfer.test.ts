import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
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
import * as stripeTransactions from "../../../utils/stripeUtils/stripeTransactions";
import * as sinon from "sinon";
import {StripeRestError} from "../../../utils/stripeUtils/StripeRestError";
import chaiExclude = require("chai-exclude");
import Stripe = require("stripe");
import ICharge = Stripe.charges.ICharge;

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

        const postValue4Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueCad2ForStripeTests);
        chai.assert.equal(postValue4Resp.statusCode, 201, `body=${JSON.stringify(postValue4Resp.body)}`);
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

    const valueCad2ForStripeTests: Partial<Value> = {
        id: "v-transfer-stripe-2",
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
            createdDate: null
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
            createdDate: null
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
            createdDate: null
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
            createdDate: null
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
            createdDate: null
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
            createdDate: null
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
            createdDate: null
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
        const testStripeLive: boolean = !!process.env["TEST_STRIPE_LIVE"];

        before(function () {
            if (!stripeEnvVarsPresent() && testStripeLive) {
                this.skip();
                return;
            }
            setStubsForStripeTests();
        });

        after(() => {
            unsetStubsForStripeTests();
        });

        afterEach(() => {
            if (!testStripeLive) {
                if ((stripeTransactions.createStripeCharge as sinon).restore) {
                    (stripeTransactions.createStripeCharge as sinon).restore();
                }
            }
        });

        it("can transfer from Stripe to Lightrail", async () => {
            const request = {
                id: generateId(),
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
            const exampleStripeResponse: ICharge = {
                "id": "ch_1CtgTrG3cz9DRdBteNgDpnpl",
                "object": "charge",
                "amount": 1000,
                "amount_refunded": 0,
                "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
                "application_fee": null,
                "balance_transaction": "txn_1CtgTsG3cz9DRdBt90tvfD4t",
                "captured": true,
                "created": 1532976751,
                "currency": "cad",
                "customer": null,
                "description": null,
                "destination": null,
                "dispute": null,
                "failure_code": null,
                "failure_message": null,
                "fraud_details": {},
                "invoice": null,
                "livemode": false,
                "metadata": {
                    "lightrailTransactionId": request.id,
                    "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${valueCadForStripeTests.id}\"}]`,
                    "lightrailUserId": defaultTestUser.userId
                },
                "on_behalf_of": null,
                "order": null,
                "outcome": {
                    "network_status": "approved_by_network",
                    "reason": null,
                    "risk_level": "normal",
                    "seller_message": "Payment complete.",
                    "type": "authorized"
                },
                "paid": true,
                "receipt_email": null,
                "receipt_number": null,
                "refunded": false,
                "refunds": {
                    "object": "list",
                    "data": [],
                    "has_more": false,
                    "total_count": 0,
                    "url": "/v1/charges/ch_1CtgTrG3cz9DRdBteNgDpnpl/refunds"
                },
                "review": null,
                "shipping": null,
                "source": {
                    "id": "card_1CtgTrG3cz9DRdBtZoaVvcCA",
                    "object": "card",
                    "address_city": null,
                    "address_country": null,
                    "address_line1": null,
                    "address_line1_check": null,
                    "address_line2": null,
                    "address_state": null,
                    "address_zip": null,
                    "address_zip_check": null,
                    "brand": "Visa",
                    "country": "US",
                    "customer": null,
                    "cvc_check": null,
                    "dynamic_last4": null,
                    "exp_month": 7,
                    "exp_year": 2019,
                    "fingerprint": "LMHNXKv7kEbxUNL9",
                    "funding": "credit",
                    "last4": "4242",
                    "metadata": {},
                    "name": null,
                    "tokenization_method": null
                },
                "source_transfer": null,
                "statement_descriptor": null,
                "status": "succeeded",
                "transfer_group": null
            };
            if (!testStripeLive) {
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.withArgs(sinon.match({
                    "amount": request.amount,
                    "currency": request.currency,
                    "metadata": {
                        "lightrailTransactionId": request.id,
                        "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${valueCadForStripeTests.id}\"}]`,
                        "lightrailUserId": defaultTestUser.userId
                    },
                    "source": "tok_visa"
                }), sinon.match("test"), sinon.match("test"), sinon.match(`${request.id}-src`)).resolves(exampleStripeResponse);
            }

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
                createdDate: null
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
                "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${valueCadForStripeTests.id}\"}]`,
                "lightrailUserId": defaultTestUser.userId
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

            if (testStripeLive) {
                const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
                const stripeChargeId = (postTransferResp.body.steps.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
                const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                    stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
                });
                chai.assert.deepEqual(stripeCharge, sourceStep.charge);
            }
        }).timeout(3000);

        it("422s transferring a negative amount from Stripe", async () => {
            if (!testStripeLive) {
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.rejects(new Error("The Stripe stub should never be called in this test"));
            }

            const request = {
                id: generateId(),
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
            };

            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
            chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        it("respects maxAmount on Stripe source with allowRemainder", async () => {
            const request = {
                id: generateId(),
                source: {
                    rail: "stripe",
                    source: "tok_visa",
                    maxAmount: 900
                },
                destination: {
                    rail: "lightrail",
                    valueId: valueCad2ForStripeTests.id
                },
                amount: 1000,
                currency: "CAD",
                allowRemainder: true
            };
            const exampleStripeResponse: ICharge = {
                "id": "ch_1CtgTtG3cz9DRdBtE4l1p4Ub",
                "object": "charge",
                "amount": 900,
                "amount_refunded": 0,
                "application": "ca_D5LfFkNWh8XbFWxIcEx6N9FXaNmfJ9Fr",
                "application_fee": null,
                "balance_transaction": "txn_1CtgTtG3cz9DRdBt6hn5bxxC",
                "captured": true,
                "created": 1532976753,
                "currency": "cad",
                "customer": null,
                "description": null,
                "destination": null,
                "dispute": null,
                "failure_code": null,
                "failure_message": null,
                "fraud_details": {},
                "invoice": null,
                "livemode": false,
                "metadata": {
                    "lightrailTransactionId": request.id,
                    "lightrailTransactionSources": "[{\"rail\":\"lightrail\",\"valueId\":\"v-transfer-stripe-2\"}]",
                    "lightrailUserId": "default-test-user-TEST"
                },
                "on_behalf_of": null,
                "order": null,
                "outcome": {
                    "network_status": "approved_by_network",
                    "reason": null,
                    "risk_level": "normal",
                    "seller_message": "Payment complete.",
                    "type": "authorized"
                },
                "paid": true,
                "receipt_email": null,
                "receipt_number": null,
                "refunded": false,
                "refunds": {
                    "object": "list",
                    "data": [],
                    "has_more": false,
                    "total_count": 0,
                    "url": "/v1/charges/ch_1CtgTtG3cz9DRdBtE4l1p4Ub/refunds"
                },
                "review": null,
                "shipping": null,
                "source": {
                    "id": "card_1CtgTtG3cz9DRdBtIsCwoH7R",
                    "object": "card",
                    "address_city": null,
                    "address_country": null,
                    "address_line1": null,
                    "address_line1_check": null,
                    "address_line2": null,
                    "address_state": null,
                    "address_zip": null,
                    "address_zip_check": null,
                    "brand": "Visa",
                    "country": "US",
                    "customer": null,
                    "cvc_check": null,
                    "dynamic_last4": null,
                    "exp_month": 7,
                    "exp_year": 2019,
                    "fingerprint": "LMHNXKv7kEbxUNL9",
                    "funding": "credit",
                    "last4": "4242",
                    "metadata": {},
                    "name": null,
                    "tokenization_method": null
                },
                "source_transfer": null,
                "statement_descriptor": null,
                "status": "succeeded",
                "transfer_group": null
            };

            if (!testStripeLive) {
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.withArgs(sinon.match({
                    "amount": request.source.maxAmount,
                    "currency": request.currency,
                    "metadata": {
                        "lightrailTransactionId": request.id,
                        "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${valueCad2ForStripeTests.id}\"}]`,
                        "lightrailUserId": defaultTestUser.userId
                    },
                    "source": "tok_visa"
                }), sinon.match("test"), sinon.match("test"), sinon.match(`${request.id}-src`)).resolves(exampleStripeResponse);
            }

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
                createdDate: null
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
                "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${valueCad2ForStripeTests.id}\"}]`,
                "lightrailUserId": defaultTestUser.userId
            });

            const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2ForStripeTests.id) as LightrailTransactionStep;
            chai.assert.deepEqual(destStep, {
                rail: "lightrail",
                valueId: valueCad2ForStripeTests.id,
                code: null,
                contactId: null,
                balanceBefore: 0,
                balanceAfter: 900,
                balanceChange: 900
            });

            const getValue4Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2ForStripeTests.id}`, "GET");
            chai.assert.equal(getValue4Resp.statusCode, 200, `body=${JSON.stringify(getValue4Resp.body)}`);
            chai.assert.equal(getValue4Resp.body.balance, 900);

            const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
            chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
            chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, ["statusCode", "steps"]);

            const sourceStepFromGet = getTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe");
            chai.assert.deepEqual(sourceStepFromGet, sourceStep);

            const destStepFromGet = getTransferResp.body.steps.find((s: LightrailTransactionStep) => s.rail === "lightrail");
            chai.assert.deepEqual(destStepFromGet, destStep);

            if (testStripeLive) {
                const lightrailStripe = require("stripe")(process.env["STRIPE_PLATFORM_KEY"]);
                const stripeChargeId = (postTransferResp.body.steps.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
                const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                    stripe_account: process.env["STRIPE_CONNECTED_ACCOUNT_ID"]
                });
                chai.assert.deepEqual(stripeCharge, sourceStep.charge);
            }
        }).timeout(3000);

        it("409s transferring from Stripe with insufficient maxAmount and allowRemainder=false", async () => {
            if (!testStripeLive) {
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.rejects(new Error("The Stripe stub should never be called in this test"));
            }

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
            if (!testStripeLive) {
                const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                stripeStub.rejects(new Error("The Stripe stub should never be called in this test"));
            }

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
                const exampleStripeError = {
                    "type": "StripeInvalidRequestError",
                    "stack": "Error: Amount must be at least 50 cents\n    at Constructor._Error (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:12:17)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Constructor (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/utils.js:124:13)\n    at Function.StripeError.generate (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/Error.js:57:12)\n    at IncomingMessage.<anonymous> (/Users/tanajukes/code/v2/internal-rothschild/node_modules/stripe/lib/StripeResource.js:170:39)\n    at emitNone (events.js:110:20)\n    at IncomingMessage.emit (events.js:207:7)\n    at endReadableNT (_stream_readable.js:1059:12)\n    at _combinedTickCallback (internal/process/next_tick.js:138:11)\n    at process._tickDomainCallback (internal/process/next_tick.js:218:9)",
                    "rawType": "invalid_request_error",
                    "code": "amount_too_small",
                    "param": "amount",
                    "message": "Amount must be at least 50 cents",
                    "raw": {
                        "code": "amount_too_small",
                        "doc_url": "https://stripe.com/docs/error-codes/amount-too-small",
                        "message": "Amount must be at least 50 cents",
                        "param": "amount",
                        "type": "invalid_request_error",
                        "headers": {
                            "server": "nginx",
                            "date": "Tue, 31 Jul 2018 18:20:40 GMT",
                            "content-type": "application/json",
                            "content-length": "234",
                            "connection": "close",
                            "access-control-allow-credentials": "true",
                            "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                            "access-control-allow-origin": "*",
                            "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                            "access-control-max-age": "300",
                            "cache-control": "no-cache, no-store",
                            "idempotency-key": "TR-insuff-stripe-amount-src",
                            "original-request": "req_EOTu9MIhTiAogt",
                            "request-id": "req_8nO7UdD8hP3DAv",
                            "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                            "stripe-version": "2018-05-21",
                            "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                        },
                        "statusCode": 400,
                        "requestId": "req_8nO7UdD8hP3DAv"
                    },
                    "headers": {
                        "server": "nginx",
                        "date": "Tue, 31 Jul 2018 18:20:40 GMT",
                        "content-type": "application/json",
                        "content-length": "234",
                        "connection": "close",
                        "access-control-allow-credentials": "true",
                        "access-control-allow-methods": "GET, POST, HEAD, OPTIONS, DELETE",
                        "access-control-allow-origin": "*",
                        "access-control-expose-headers": "Request-Id, Stripe-Manage-Version, X-Stripe-External-Auth-Required, X-Stripe-Privileged-Session-Required",
                        "access-control-max-age": "300",
                        "cache-control": "no-cache, no-store",
                        "idempotency-key": "TR-insuff-stripe-amount-src",
                        "original-request": "req_EOTu9MIhTiAogt",
                        "request-id": "req_8nO7UdD8hP3DAv",
                        "stripe-account": "acct_1CfBBRG3cz9DRdBt",
                        "stripe-version": "2018-05-21",
                        "strict-transport-security": "max-age=31556926; includeSubDomains; preload"
                    },
                    "requestId": "req_8nO7UdD8hP3DAv",
                    "statusCode": 400
                };
                const exampleErrorResponse = new StripeRestError(422, "Error for tests: Stripe minimum not met", "StripeAmountTooSmall", exampleStripeError);

                if (!testStripeLive) {
                    const stripeStub = sinon.stub(stripeTransactions, "createStripeCharge");
                    stripeStub.withArgs(sinon.match({
                        "amount": request.amount,
                        "currency": request.currency,
                        "metadata": {
                            "lightrailTransactionId": request.id,
                            "lightrailTransactionSources": `[{\"rail\":\"lightrail\",\"valueId\":\"${valueCadForStripeTests.id}\"}]`,
                            "lightrailUserId": defaultTestUser.userId
                        },
                        "source": "tok_visa"
                    }), sinon.match("test"), sinon.match("test"), sinon.match(`${request.id}-src`)).rejects(exampleErrorResponse);
                }

                const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
                chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
                chai.assert.isNotNull((postTransferResp.body as any).messageCode, `body=${JSON.stringify(postTransferResp.body)}`);
                chai.assert.equal((postTransferResp.body as any).messageCode, "StripeAmountTooSmall", `body=${JSON.stringify(postTransferResp.body)}`);
            });
        });
    });
});

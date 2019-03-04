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
    stripeLiveLightrailConfig,
    stripeLiveMerchantConfig,
    stubNoStripeCharge,
    stubTransferStripeCharge,
    stubTransferStripeError,
    testStripeLive,
    unsetStubsForStripeTests
} from "../../../utils/testUtils/stripeTestUtils";
import {createCurrency} from "../currencies";
import {StripeRestError} from "../../../utils/stripeUtils/StripeRestError";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import {stripeApiVersion} from "../../../utils/stripeUtils/StripeConfig";
import {TransferRequest} from "../../../model/TransactionRequest";
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["steps", "createdDate", "createdBy"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad1.id) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueCad1.id,
            code: null,
            contactId: null,
            balanceBefore: 1500,
            balanceAfter: 500,
            balanceChange: -1000,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2.id) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueCad2.id,
            code: null,
            contactId: null,
            balanceBefore: 2500,
            balanceAfter: 3500,
            balanceChange: 1000,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const getValue1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad1.id}`, "GET");
        chai.assert.equal(getValue1Resp.statusCode, 200, `body=${JSON.stringify(getValue1Resp.body)}`);
        chai.assert.equal(getValue1Resp.body.balance, 500);

        const getValue2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2.id}`, "GET");
        chai.assert.equal(getValue2Resp.statusCode, 200, `body=${JSON.stringify(getValue2Resp.body)}`);
        chai.assert.equal(getValue2Resp.body.balance, 3500);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer-1", "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqual(getTransferResp.body, postTransferResp.body);

        // check DbTransaction created by transfer
        const knex = await getKnexRead();
        const res = await knex("Transactions")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: postTransferResp.body.id
            });
        chai.assert.deepEqualExcluding(
            res[0], {
                "userId": "default-test-user-TEST",
                "id": "transfer-1",
                "transactionType": "transfer",
                "currency": "CAD",
                "lineItems": "null",
                "paymentSources": "null",
                "pendingVoidDate": null,
                "metadata": "null",
                "tax": "null",
                "createdBy": "default-test-user-TEST",
                "nextTransactionId": null,
                "rootTransactionId": "transfer-1",
                "totals_subtotal": null,
                "totals_tax": null,
                "totals_discountLightrail": null,
                "totals_paidLightrail": null,
                "totals_paidStripe": null,
                "totals_paidInternal": null,
                "totals_remainder": 0,
                "totals_marketplace_sellerGross": null,
                "totals_marketplace_sellerDiscount": null,
                "totals_marketplace_sellerNet": null
            }, ["createdDate", "totals"]
        );
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["steps", "createdDate", "createdBy"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueSecretCode.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueSecretCode.id,
            code: "…CRET",
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueSecretCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 0);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 200);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestFromSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqual(getTransferResp.body, postTransferResp.body);
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["steps", "createdDate", "createdBy"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueSecretCode.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueSecretCode.id,
            code: "…CRET",
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueSecretCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 200);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 0);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestToSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqual(getTransferResp.body, postTransferResp.body);
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["steps", "createdDate", "createdBy"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueGenericCode.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueGenericCode.id,
            code: valueGenericCode.code,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueGenericCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 0);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 200);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestFromSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqual(getTransferResp.body, postTransferResp.body);
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["steps", "createdDate", "createdBy"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === basicValue.id);
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: basicValue.id,
            code: null,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 0,
            balanceChange: -100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueGenericCode.id);
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueGenericCode.id,
            code: valueGenericCode.code,
            contactId: null,
            balanceBefore: 100,
            balanceAfter: 200,
            balanceChange: 100,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const getSecretCodeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueGenericCode.id}`, "GET");
        chai.assert.equal(getSecretCodeValueResp.statusCode, 200, `body=${JSON.stringify(getSecretCodeValueResp.body)}`);
        chai.assert.equal(getSecretCodeValueResp.body.balance, 200);

        const getBasicValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${basicValue.id}`, "GET");
        chai.assert.equal(getBasicValueResp.statusCode, 200, `body=${JSON.stringify(getBasicValueResp.body)}`);
        chai.assert.equal(getBasicValueResp.body.balance, 0);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${requestToSecret.id}`, "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqual(getTransferResp.body, postTransferResp.body);
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        };
        chai.assert.equal(postTransferResp.statusCode, 200, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, validObject, ["steps", "createdDate", "simulated"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad1.id) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueCad1.id,
            code: null,
            contactId: null,
            balanceBefore: 500,
            balanceAfter: 0,
            balanceChange: -500,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2.id) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueCad2.id,
            code: null,
            contactId: null,
            balanceBefore: 3500,
            balanceAfter: 4000,
            balanceChange: 500,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
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
            pending: false,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["steps", "createdDate", "createdBy"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad1.id) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueId: valueCad1.id,
            code: null,
            contactId: null,
            balanceBefore: 500,
            balanceAfter: 0,
            balanceChange: -500,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueId === valueCad2.id) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueId: valueCad2.id,
            code: null,
            contactId: null,
            balanceBefore: 3500,
            balanceAfter: 4000,
            balanceChange: 500,
            usesRemainingBefore: null,
            usesRemainingAfter: null,
            usesRemainingChange: null
        });

        const getValue1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad1.id}`, "GET");
        chai.assert.equal(getValue1Resp.statusCode, 200, `body=${JSON.stringify(getValue1Resp.body)}`);
        chai.assert.equal(getValue1Resp.body.balance, 0);

        const getValue2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2.id}`, "GET");
        chai.assert.equal(getValue2Resp.statusCode, 200, `body=${JSON.stringify(getValue2Resp.body)}`);
        chai.assert.equal(getValue2Resp.body.balance, 4000);

        const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer-3", "GET");
        chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
        chai.assert.deepEqual(getTransferResp.body, postTransferResp.body);
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
        chai.assert.equal(resp.body.messageCode, "WrongCurrency");
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

    it("409s transferring to or from a Value that is canceled", async () => {
        const canceledValue: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 7800
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", canceledValue);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const cancelResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${canceledValue.id}`, "PATCH", {
            canceled: true
        });
        chai.assert.equal(cancelResp.statusCode, 200, `body=${JSON.stringify(cancelResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-canceled",
            source: {
                rail: "lightrail",
                valueId: canceledValue.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueCanceled");

        const resp2 = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-canceled-2",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: canceledValue.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp2.statusCode, 409, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueCanceled");
    });

    it("409s transferring to or from a Value that is frozen", async () => {
        const frozenValue: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 7800
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", frozenValue);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const freezeResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${frozenValue.id}`, "PATCH", {
            frozen: true
        });
        chai.assert.equal(freezeResp.statusCode, 200, `body=${JSON.stringify(freezeResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-frozen",
            source: {
                rail: "lightrail",
                valueId: frozenValue.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueFrozen");

        const resp2 = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-frozen-2",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: frozenValue.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp2.statusCode, 409, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueFrozen");
    });

    it("409s transferring to or from a Value that has not started yet", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 734545,
            startDate: new Date("2099-02-03")
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-not-started",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            amount: 8,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueNotStarted");

        const resp2 = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-not-started-2",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 8,
            currency: "CAD"
        });
        chai.assert.equal(resp2.statusCode, 409, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueNotStarted");
    });

    it("409s transferring to or from a Value that has ended", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 734545,
            endDate: new Date("1999-02-03")
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-ended",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            destination: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            amount: 8,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueEnded");

        const resp2 = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer-ended-2",
            source: {
                rail: "lightrail",
                valueId: valueCad1.id
            },
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 8,
            currency: "CAD"
        });
        chai.assert.equal(resp2.statusCode, 409, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueEnded");
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
            setStubsForStripeTests();
        });

        after(() => {
            unsetStubsForStripeTests();
        });

        it("can transfer from Stripe to Lightrail", async () => {
            const request: TransferRequest = {
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

            stubTransferStripeCharge(request);
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
                pending: false,
                metadata: null,
                tax: null,
                createdDate: null,
                createdBy: defaultTestUser.auth.teamMemberId
            }, ["steps", "createdDate", "createdBy"]);
            chai.assert.lengthOf(postTransferResp.body.steps, 2);
            chai.assert.equal(postTransferResp.body.steps[0].rail, "stripe");

            const sourceStep = postTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe") as StripeTransactionStep;
            chai.assert.deepEqualExcluding<StripeTransactionStep>(sourceStep, {
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
                balanceChange: 1000,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
            });

            const getValue3Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCadForStripeTests.id}`, "GET");
            chai.assert.equal(getValue3Resp.statusCode, 200, `body=${JSON.stringify(getValue3Resp.body)}`);
            chai.assert.equal(getValue3Resp.body.balance, 1000);

            const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
            chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
            chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, ["steps"]);

            const sourceStepFromGet = getTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe");
            chai.assert.deepEqual(sourceStepFromGet, sourceStep);

            const destStepFromGet = getTransferResp.body.steps.find((s: LightrailTransactionStep) => s.rail === "lightrail");
            chai.assert.deepEqual(destStepFromGet, destStep);

            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
                lightrailStripe.setApiVersion(stripeApiVersion);
                const stripeChargeId = (postTransferResp.body.steps.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
                const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                    stripe_account: stripeLiveMerchantConfig.stripeUserId
                });
                chai.assert.deepEqual(stripeCharge, sourceStep.charge);
            }
        }).timeout(10000);

        it("422s transferring a negative amount from Stripe", async () => {
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

            stubNoStripeCharge(request);
            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
            chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        it("respects maxAmount on Stripe source with allowRemainder", async () => {
            const request: TransferRequest = {
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

            stubTransferStripeCharge(request);
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
                pending: false,
                metadata: null,
                tax: null,
                createdDate: null,
                createdBy: defaultTestUser.auth.teamMemberId
            }, ["steps", "createdDate", "createdBy"]);
            chai.assert.lengthOf(postTransferResp.body.steps, 2);
            chai.assert.equal(postTransferResp.body.steps[0].rail, "stripe");

            const sourceStep = postTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe") as StripeTransactionStep;
            chai.assert.deepEqualExcluding<StripeTransactionStep>(sourceStep, {
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
                balanceChange: 900,
                usesRemainingBefore: null,
                usesRemainingAfter: null,
                usesRemainingChange: null
            });

            const getValue4Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueCad2ForStripeTests.id}`, "GET");
            chai.assert.equal(getValue4Resp.statusCode, 200, `body=${JSON.stringify(getValue4Resp.body)}`);
            chai.assert.equal(getValue4Resp.body.balance, 900);

            const getTransferResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
            chai.assert.equal(getTransferResp.statusCode, 200, `body=${JSON.stringify(getTransferResp.body)}`);
            chai.assert.deepEqualExcluding(getTransferResp.body, postTransferResp.body, ["steps"]);

            const sourceStepFromGet = getTransferResp.body.steps.find((s: StripeTransactionStep) => s.rail === "stripe");
            chai.assert.deepEqual(sourceStepFromGet, sourceStep);

            const destStepFromGet = getTransferResp.body.steps.find((s: LightrailTransactionStep) => s.rail === "lightrail");
            chai.assert.deepEqual(destStepFromGet, destStep);

            if (testStripeLive()) {
                const lightrailStripe = require("stripe")(stripeLiveLightrailConfig.secretKey);
                lightrailStripe.setApiVersion(stripeApiVersion);
                const stripeChargeId = (postTransferResp.body.steps.find(source => source.rail === "stripe") as StripeTransactionStep).chargeId;
                const stripeCharge = await lightrailStripe.charges.retrieve(stripeChargeId, {
                    stripe_account: stripeLiveMerchantConfig.stripeUserId
                });
                chai.assert.deepEqual(stripeCharge, sourceStep.charge);
            }
        }).timeout(10000);

        it("409s transferring from Stripe with insufficient maxAmount and allowRemainder=false", async () => {
            const request: TransferRequest = {
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
            };
            stubNoStripeCharge(request);

            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
            chai.assert.equal(postTransferResp.statusCode, 409, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        it("422s transferring to Stripe from Lightrail", async () => {
            const request: TransferRequest = {
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
            };

            stubNoStripeCharge(request);
            const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
            chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
        });

        describe("respects Stripe minimum of $0.50", () => {
            it("fails the transfer by default", async () => {
                const request: TransferRequest = {
                    id: generateId(),
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
                            "idempotency-key": request.id + "-0",
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
                        "idempotency-key": request.id + "-0",
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
                stubTransferStripeError(request, exampleErrorResponse);

                const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", request);
                chai.assert.equal(postTransferResp.statusCode, 422, `body=${JSON.stringify(postTransferResp.body)}`);
                chai.assert.isNotNull((postTransferResp.body as any).messageCode, `body=${JSON.stringify(postTransferResp.body)}`);
                chai.assert.equal((postTransferResp.body as any).messageCode, "StripeAmountTooSmall", `body=${JSON.stringify(postTransferResp.body)}`);
            });
        });
    });

    describe("max id length checks", () => {
        const source: Partial<Value> = {
            id: generateId(64),
            currency: "CAD",
            balance: 1,
        };
        const destination: Partial<Value> = {
            id: generateId(64),
            currency: "CAD",
            balance: 0,
        };

        before(async function () {
            const createSourceValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", source);
            chai.assert.equal(createSourceValue.statusCode, 201, JSON.stringify(createSourceValue));
            const createDestinationValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", destination);
            chai.assert.equal(createDestinationValue.statusCode, 201, JSON.stringify(createDestinationValue));
        });

        it("can create transfer with maximum id length", async () => {
            const transfer: Partial<TransferRequest> = {
                id: generateId(64),
                source: {
                    rail: "lightrail",
                    valueId: source.id
                },
                destination: {
                    rail: "lightrail",
                    valueId: destination.id
                },
                amount: 1,
                currency: "CAD"
            };
            const createTransfer = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", transfer);
            chai.assert.equal(createTransfer.statusCode, 201, `body=${JSON.stringify(createTransfer.body)}`);
        });

        it("cannot create transfer with id exceeding max length of 64 - returns 422", async () => {
            const credit: Partial<TransferRequest> = {
                id: generateId(65),
                source: {
                    rail: "lightrail",
                    valueId: source.id
                },
                destination: {
                    rail: "lightrail",
                    valueId: destination.id
                },
                amount: 1,
                currency: "CAD"
            };
            const createTransfer = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/transfer", "POST", credit);
            chai.assert.equal(createTransfer.statusCode, 422, `body=${JSON.stringify(createTransfer.body)}`);
            chai.assert.include(createTransfer.body.message, "requestBody.id does not meet maximum length of 64");
        });
    });
});

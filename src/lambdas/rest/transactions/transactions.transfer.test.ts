import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../../testUtils";
import {Value} from "../../../model/Value";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {Currency} from "../../../model/Currency";
import {installRestRoutes} from "../installRestRoutes";

describe("/v2/transactions/transfer", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);
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

    it("can transfer between valueIds", async () => {
        const postCurrencyResp = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(postCurrencyResp.statusCode, 201, `body=${JSON.stringify(postCurrencyResp.body)}`);

        const postValue1Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueCad1);
        chai.assert.equal(postValue1Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);

        const postValue2Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueCad2);
        chai.assert.equal(postValue2Resp.statusCode, 201, `body=${JSON.stringify(postValue1Resp.body)}`);

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
            totals: {remainder: 0},
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
        const validObject = {
            id: "transfer-2",
            transactionType: "transfer",
            totals: {remainder: 0},
            currency: "CAD",
            lineItems: null,
            steps: null,
            paymentSources: null,
            metadata: null,
            createdDate: null
        };
        chai.assert.equal(postTransferResp.statusCode, 200, `body=${JSON.stringify(postTransferResp.body)}`);
        // chai.assert.deepEqualExcluding(postTransferResp.body, validObject, ["steps", "createdDate"]);   // TODO this should be fine but the compiler complains. validObject copied directly into test below as temp measure.
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            id: "transfer-2",
            transactionType: "transfer",
            totals: {remainder: 0},
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
            totals: {remainder: 7500 - 500},
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

    it("409s transferring between valueIds where the source has insufficient value", async () => {
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
        chai.assert.equal(resp.body.messageCode, "InsufficientValue");
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
});

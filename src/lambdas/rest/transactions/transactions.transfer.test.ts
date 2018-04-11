import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";

describe("/v2/transactions/transfer", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    const valueStoreCad1: Partial<ValueStore> = {
        valueStoreId: "vs-transfer-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 1500
    };

    const valueStoreCad2: Partial<ValueStore> = {
        valueStoreId: "vs-transfer-2",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 2500
    };

    const valueStoreUsd: Partial<ValueStore> = {
        valueStoreId: "vs-transfer-3",
        valueStoreType: "GIFTCARD",
        currency: "USD",
        value: 3500
    };

    it("can transfer between valueStoreIds", async () => {
        const postValueStore1Resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStoreCad1);
        chai.assert.equal(postValueStore1Resp.statusCode, 201, `body=${JSON.stringify(postValueStore1Resp.body)}`);

        const postValueStore2Resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStoreCad2);
        chai.assert.equal(postValueStore2Resp.statusCode, 201, `body=${JSON.stringify(postValueStore1Resp.body)}`);

        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-1",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            transactionId: "transfer-1",
            transactionType: "transfer",
            remainder: 0
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStoreCad1.valueStoreId) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueStoreId: valueStoreCad1.valueStoreId,
            valueStoreType: valueStoreCad1.valueStoreType,
            currency: valueStoreCad1.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 1500,
            valueAfter: 500,
            valueChange: -1000
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStoreCad2.valueStoreId) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueStoreId: valueStoreCad2.valueStoreId,
            valueStoreType: valueStoreCad2.valueStoreType,
            currency: valueStoreCad2.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 2500,
            valueAfter: 3500,
            valueChange: 1000
        });

        const getValueStore1Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStoreCad1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore1Resp.statusCode, 200, `body=${JSON.stringify(getValueStore1Resp.body)}`);
        chai.assert.equal(getValueStore1Resp.body.value, 500);

        const getValueStore2Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStoreCad2.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore2Resp.statusCode, 200, `body=${JSON.stringify(getValueStore2Resp.body)}`);
        chai.assert.equal(getValueStore2Resp.body.value, 3500);
    });

    it("409s on reusing a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-1",    // same as above
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 15,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a transfer between valueStoreIds", async () => {
        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-2",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 500,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postTransferResp.statusCode, 200, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            transactionId: "transfer-2",
            transactionType: "transfer",
            remainder: 0
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStoreCad1.valueStoreId) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueStoreId: valueStoreCad1.valueStoreId,
            valueStoreType: valueStoreCad1.valueStoreType,
            currency: valueStoreCad1.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 500,
            valueAfter: 0,
            valueChange: -500
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStoreCad2.valueStoreId) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueStoreId: valueStoreCad2.valueStoreId,
            valueStoreType: valueStoreCad2.valueStoreType,
            currency: valueStoreCad2.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 3500,
            valueAfter: 4000,
            valueChange: 500
        });

        const getValueStore1Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStoreCad1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore1Resp.statusCode, 200, `body=${JSON.stringify(getValueStore1Resp.body)}`);
        chai.assert.equal(getValueStore1Resp.body.value, 500, "value did not actually change");

        const getValueStore2Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStoreCad2.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore2Resp.statusCode, 200, `body=${JSON.stringify(getValueStore2Resp.body)}`);
        chai.assert.equal(getValueStore2Resp.body.value, 3500, "value did not actually change");
    });

    it("can transfer between valueStoreIds with allowRemainder", async () => {
        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-3",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 7500,
            currency: "CAD",
            allowRemainder: true
        });
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${JSON.stringify(postTransferResp.body)}`);
        chai.assert.deepEqualExcluding(postTransferResp.body, {
            transactionId: "transfer-3",
            transactionType: "transfer",
            remainder: 7500 - 500
        }, ["steps", "createdDate"]);
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStoreCad1.valueStoreId) as LightrailTransactionStep;
        chai.assert.deepEqual(sourceStep, {
            rail: "lightrail",
            valueStoreId: valueStoreCad1.valueStoreId,
            valueStoreType: valueStoreCad1.valueStoreType,
            currency: valueStoreCad1.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 500,
            valueAfter: 0,
            valueChange: -500
        });

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStoreCad2.valueStoreId) as LightrailTransactionStep;
        chai.assert.deepEqual(destStep, {
            rail: "lightrail",
            valueStoreId: valueStoreCad2.valueStoreId,
            valueStoreType: valueStoreCad2.valueStoreType,
            currency: valueStoreCad2.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 3500,
            valueAfter: 4000,
            valueChange: 500
        });

        const getValueStore1Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStoreCad1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore1Resp.statusCode, 200, `body=${JSON.stringify(getValueStore1Resp.body)}`);
        chai.assert.equal(getValueStore1Resp.body.value, 0);

        const getValueStore2Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStoreCad2.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore2Resp.statusCode, 200, `body=${JSON.stringify(getValueStore2Resp.body)}`);
        chai.assert.equal(getValueStore2Resp.body.value, 4000);
    });

    it("cannot transfer between valueStoreIds where the source has insufficient value", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-4",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 2000,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InsufficientValue");
    });

    it("cannot transfer between valueStoreIds in the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-5",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 1,
            currency: "XXX"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("cannot transfer from an invalid valueStoreId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-6",
            source: {
                rail: "lightrail",
                valueStoreId: "idontexist"
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("cannot transfer to an invalid valueStoreId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-7",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: "idontexist"
            },
            value: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("cannot transfer from a valueStoreId in the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-8",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreUsd.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreCad2.valueStoreId
            },
            value: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("cannot transfer to a valueStoreId in the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-9",
            source: {
                rail: "lightrail",
                valueStoreId: valueStoreCad1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStoreUsd.valueStoreId
            },
            value: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });
});

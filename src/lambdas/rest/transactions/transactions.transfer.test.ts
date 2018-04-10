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

    const valueStore1: Partial<ValueStore> = {
        valueStoreId: "vs-transfer-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 1500
    };

    const valueStore2: Partial<ValueStore> = {
        valueStoreId: "vs-transfer-2",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 2500
    };

    it("can credit a gift card by valueStoreId", async () => {
        const postValueStore1Resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(postValueStore1Resp.statusCode, 201, `body=${postValueStore1Resp.body}`);

        const postValueStore2Resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore2);
        chai.assert.equal(postValueStore2Resp.statusCode, 201, `body=${postValueStore1Resp.body}`);

        const postTransferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-1",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore2.valueStoreId
            },
            value: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postTransferResp.statusCode, 201, `body=${postTransferResp.body}`);

        chai.assert.equal(postTransferResp.body.transactionId, "transfer-1");
        chai.assert.equal(postTransferResp.body.transactionType, "transfer");
        chai.assert.lengthOf(postTransferResp.body.steps, 2);

        const sourceStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStore1.valueStoreId) as LightrailTransactionStep;
        chai.assert.isObject(sourceStep, "find source step");
        chai.assert.equal(sourceStep.rail, "lightrail");
        chai.assert.equal(sourceStep.valueStoreId, valueStore1.valueStoreId);
        chai.assert.equal(sourceStep.valueStoreType, valueStore1.valueStoreType);
        chai.assert.equal(sourceStep.currency, valueStore1.currency);
        chai.assert.equal(sourceStep.valueBefore, 1500);
        chai.assert.equal(sourceStep.valueAfter, 500);
        chai.assert.equal(sourceStep.valueChange, -1000);

        const destStep = postTransferResp.body.steps.find((s: LightrailTransactionStep) => s.valueStoreId === valueStore2.valueStoreId) as LightrailTransactionStep;
        chai.assert.isObject(destStep, "find dest step");
        chai.assert.equal(destStep.rail, "lightrail");
        chai.assert.equal(destStep.valueStoreId, valueStore2.valueStoreId);
        chai.assert.equal(destStep.valueStoreType, valueStore2.valueStoreType);
        chai.assert.equal(destStep.currency, valueStore2.currency);
        chai.assert.equal(destStep.valueBefore, 2500);
        chai.assert.equal(destStep.valueAfter, 3500);
        chai.assert.equal(destStep.valueChange, 1000);

        const getValueStore1Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore1Resp.statusCode, 200, `body=${postValueStore1Resp.body}`);
        chai.assert.equal(getValueStore1Resp.body.value, 500);

        const getValueStore2Resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore2.valueStoreId}`, "GET");
        chai.assert.equal(getValueStore2Resp.statusCode, 200, `body=${getValueStore2Resp.body}`);
        chai.assert.equal(getValueStore2Resp.body.value, 3500);
    });
});

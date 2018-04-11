import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";

describe("/v2/transactions/credit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    const valueStore1: Partial<ValueStore> = {
        valueStoreId: "vs-credit-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 0
    };

    it("can credit by valueStoreId", async () => {
        const postValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${postValueStoreResp.body}`);

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-1",
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${postCreditResp.body}`);
        chai.assert.equal(postCreditResp.body.transactionId, "credit-1");
        chai.assert.equal(postCreditResp.body.transactionType, "credit");
        chai.assert.lengthOf(postCreditResp.body.steps, 1);

        const step = postCreditResp.body.steps[0] as LightrailTransactionStep;
        chai.assert.equal(step.rail, "lightrail");
        chai.assert.equal(step.valueStoreId, valueStore1.valueStoreId);
        chai.assert.equal(step.valueStoreType, valueStore1.valueStoreType);
        chai.assert.equal(step.currency, valueStore1.currency);
        chai.assert.equal(step.valueBefore, 0);
        chai.assert.equal(step.valueAfter, 1000);
        chai.assert.equal(step.valueChange, 1000);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(postValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 1000);
    });

    it("can simulate a credit by valueStoreId", async () => {
        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-2",
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: 1100,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postCreditResp.statusCode, 200, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.equal(postCreditResp.body.transactionId, "credit-2");
        chai.assert.equal(postCreditResp.body.transactionType, "credit");
        chai.assert.lengthOf(postCreditResp.body.steps, 1);

        const step = postCreditResp.body.steps[0] as LightrailTransactionStep;
        chai.assert.deepEqual(step, {
            rail: "lightrail",
            valueStoreId: valueStore1.valueStoreId,
            valueStoreType: valueStore1.valueStoreType,
            currency: valueStore1.currency,
            codeLastFour: null,
            customerId: null,
            valueBefore: 1000,
            valueAfter: 2100,
            valueChange: 1100
        });

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 1000, "value did not actually change");
    });

    it("409s crediting by valueStoreId of the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-3",
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s crediting a valueStoreId that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-4",
            destination: {
                rail: "lightrail",
                valueStoreId: "idontexist"
            },
            value: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });
});

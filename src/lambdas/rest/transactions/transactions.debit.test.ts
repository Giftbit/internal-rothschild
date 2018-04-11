import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";
import {Transaction} from "../../../model/Transaction";

describe("/v2/transactions/debit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    const valueStore1: Partial<ValueStore> = {
        valueStoreId: "vs-debit-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 1000
    };

    it("can debit by valueStoreId", async () => {
        const postValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-1",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: -599,
            currency: "CAD"
        });
        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            transactionId: "debit-1",
            transactionType: "debit",
            remainder: 0,
            steps: [
                {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId,
                    valueStoreType: valueStore1.valueStoreType,
                    currency: valueStore1.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 1000,
                    valueAfter: 401,
                    valueChange: -599
                }
            ]
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 401);
    });

    it("409s on reusing a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-1",   // same as above
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: -100,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a debit by valueStoreId", async () => {
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-2",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: -300,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postDebitResp.statusCode, 200, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            transactionId: "debit-2",
            transactionType: "debit",
            remainder: 0,
            steps: [
                {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId,
                    valueStoreType: valueStore1.valueStoreType,
                    currency: valueStore1.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 401,
                    valueAfter: 101,
                    valueChange: -300
                }
            ]
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 401, "the value did not actually change");
    });

    it("can debit by valueStoreId with allowRemainder", async () => {
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-3",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: -9500,
            currency: "CAD",
            allowRemainder: true
        });
        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            transactionId: "debit-3",
            transactionType: "debit",
            remainder: 401 - 9500,
            steps: [
                {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId,
                    valueStoreType: valueStore1.valueStoreType,
                    currency: valueStore1.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 401,
                    valueAfter: 0,
                    valueChange: -401
                }
            ]
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(getValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 0);
    });

    it("409s debiting by valueStoreId of the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-4",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: -301,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s debiting by valueStoreId for more money than is available", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-5",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            value: -1301,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InsufficientValue");
    });

    it("409s debiting a valueStoreId that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            transactionId: "debit-6",
            source: {
                rail: "lightrail",
                valueStoreId: "idontexist"
            },
            value: -1301,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });
});

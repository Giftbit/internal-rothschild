import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {Transaction} from "../../../model/Transaction";
import {ValueStore} from "../../../model/ValueStore";

describe("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    it("can retrieve 0 transactions", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, {
            transactions: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    const valueStore1: Partial<ValueStore> = {
        valueStoreId: "vs-gc-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 1000
    };
    const valueStore2: Partial<ValueStore> = {
        valueStoreId: "vs-gc-2",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 0
    };

    it("can retrieve 1 transactions with 2 steps", async () => {
        const postValueStoreResp1 = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(postValueStoreResp1.statusCode, 201, `body=${JSON.stringify(postValueStoreResp1.body)}`);
        const postValueStoreResp2 = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore2);
        chai.assert.equal(postValueStoreResp2.statusCode, 201, `body=${JSON.stringify(postValueStoreResp2.body)}`);

        const transfer1 = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/transactions/transfer", "POST", {
            transactionId: "transfer-1",
            currency: "CAD",
            amount: 1,
            source: {
                rail: "lightrail",
                valueStoreId: "vs-gc-1",
            },
            destination: {
                rail: "lightrail",
                valueStoreId: "vs-gc-2"
            }
        });
        chai.assert.equal(transfer1.statusCode, 201, `body=${JSON.stringify(transfer1.body)}`);

        const resp = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET");

        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.transactions.length, 1);
        chai.assert.equal(resp.body.transactions[0].steps.length, 2);
    });

    it("can retrieve 2 transactions (1 or 2 steps)", async () => {
        const debit1 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            transactionId: "tx-1",
            source: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            amount: 2,
            currency: "CAD"
        });
        chai.assert.equal(debit1.statusCode, 201, `body=${JSON.stringify(debit1.body)}`);


        const resp = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET");

        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.transactions.length, 2);
        chai.assert.equal(resp.body.transactions[0].steps.length, 2);
        chai.assert.equal(resp.body.transactions[1].steps.length, 1);
    });
});
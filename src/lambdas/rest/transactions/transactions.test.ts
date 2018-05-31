import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../testUtils";
import {Transaction} from "../../../model/Transaction";
import {DebitRequest, TransferRequest} from "../../../model/TransactionRequest";
import {installRest} from "../index";
import {Value} from "../../../model/Value";

describe("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);

        await testUtils.addCurrency(router, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("can retrieve 0 transactions", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, {
            transactions: [],
            pagination: {
                totalCount: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    const value1: Partial<Value> = {
        id: "vs-gc-1",
        currency: "CAD",
        balance: 1000
    };
    const value2: Partial<Value> = {
        id: "vs-gc-2",
        currency: "CAD",
        balance: 0
    };
    const transfer1: Partial<TransferRequest> = {
        id: "transfer-1",
        currency: "CAD",
        amount: 1,
        source: {
            rail: "lightrail",
            valueId: "vs-gc-1",
        },
        destination: {
            rail: "lightrail",
            valueId: "vs-gc-2"
        }
    };
    const debit1: Partial<DebitRequest> = {
        id: "tx-1",
        source: {
            rail: "lightrail",
            valueId: value1.id
        },
        amount: 2,
        currency: "CAD"
    };

    it("can retrieve 1 transactions with 2 steps", async () => {
        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const transferResp = await testUtils.testAuthedRequest<Value>(router, "/v2/transactions/transfer", "POST", transfer1);
        chai.assert.equal(transferResp.statusCode, 201, `body=${JSON.stringify(transferResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.transactions.length, 1);
        chai.assert.equal(resp.body.transactions[0].steps.length, 2);
    });

    it("can retrieve 2 transactions (1 or 2 steps)", async () => {
        const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit1);
        chai.assert.equal(debitResp.statusCode, 201, `body=${JSON.stringify(debitResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.transactions.length, 2);
        chai.assert.equal(resp.body.transactions[0].steps.length, 2);
        chai.assert.equal(resp.body.transactions[1].steps.length, 1);
    });

    it("can get a transaction by id", async () => {
        const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transfer1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.id, transfer1.id, `body=${JSON.stringify(resp.body)}`);
    });

    describe("filter transactions by query params", () => {
        it("can filter by type", async () => {
            const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions?transactionType=transfer", "GET");
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.equal(resp.body.transactions.length, 1);
            chai.assert.equal(resp.body.transactions[0].steps.length, 2);
        });

        it("can filter by minCreatedDate", async () => {
            const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions?minCreatedDate=2018-01-01", "GET");
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.equal(resp.body.transactions.length, 2);
            chai.assert.equal(resp.body.transactions[0].steps.length, 2);
            chai.assert.equal(resp.body.transactions[1].steps.length, 1);
        });

        it("can filter by maxCreatedDate", async () => {
            const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions?maxCreatedDate=2018-01-01", "GET");
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.equal(resp.body.transactions.length, 0);
        });
    });

    describe.skip("filter transactions by pagination params", () => {
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../../testUtils";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {installRest} from "../index";

describe("/v2/transactions/debit", () => {

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

    const value1: Partial<Value> = {
        id: "v-debit-1",
        currency: "CAD",
        balance: 1000
    };

    it("can debit by value ID", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-1",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 599,
            currency: "CAD"
        });

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-1",
            transactionType: "debit",
            currency: "CAD",
            totals: {remainder: 0},
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 401,
                    balanceChange: -599
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 401);
    });

    it("409s on reusing a transaction ID", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-1",   // same as above
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 100,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a debit by value ID", async () => {
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-2",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 300,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postDebitResp.statusCode, 200, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-2",
            transactionType: "debit",
            currency: "CAD",
            totals: {remainder: 0},
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 401,
                    balanceAfter: 101,
                    balanceChange: -300
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 401, "the value did not actually change");
    });

    it("can debit by value ID with allowRemainder", async () => {
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-3",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 9500,
            currency: "CAD",
            allowRemainder: true
        });
        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-3",
            transactionType: "debit",
            currency: "CAD",
            totals: {remainder: 9500 - 401},
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 401,
                    balanceAfter: 0,
                    balanceChange: -401
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);
    });

    it("409s debiting by value ID of the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-4",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 301,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s debiting by value ID for more money than is available", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-5",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 1301,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InsufficientValue");
    });

    it("409s debiting a value ID that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-6",
            source: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1301,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("422s debiting without a transaction ID", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s debiting with an invalid transaction ID", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: 123,
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: -1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });
});

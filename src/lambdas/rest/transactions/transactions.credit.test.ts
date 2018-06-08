import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../../testUtils";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {Currency} from "../../../model/Currency";
import {installRest} from "../index";

describe("/v2/transactions/credit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);
    });

    const currency: Currency = {
        code: "CAD",
        name: "Maple leaves",
        symbol: "$",
        decimalPlaces: 2
    };

    const value: Partial<Value> = {
        id: "v-credit-1",
        currency: "CAD",
        balance: 0
    };

    it("can credit by valueId", async () => {
        const postCurrencyResp = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(postCurrencyResp.statusCode, 201, `body=${JSON.stringify(postCurrencyResp.body)}`);

        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: "credit-1",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: "credit-1",
            transactionType: "credit",
            totals: {remainder: 0},
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    currency: value.currency,
                    code: null,
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 1000,
                    balanceChange: 1000
                }
            ]
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000);
    });

    it("409s on reusing an id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-1",  // same as above
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 1350,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a credit by valueId", async () => {
        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: "credit-2",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 1100,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postCreditResp.statusCode, 200, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: "credit-2",
            transactionType: "credit",
            totals: {remainder: 0},
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    currency: value.currency,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 2100,
                    balanceChange: 1100
                }
            ]
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000, "value did not actually change");
    });

    it("409s crediting by valueId of the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-3",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("409s crediting a valueId that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-4",
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("422s crediting without an id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s crediting with an invalid id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: 123,
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });
});

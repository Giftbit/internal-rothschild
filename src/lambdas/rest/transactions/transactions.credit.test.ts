import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser} from "../../../utils/testUtils";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import * as currencies from "../currencies";
import {installRestRoutes} from "../installRestRoutes";

describe("/v2/transactions/credit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);

        await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    const value: Partial<Value> = {
        id: "v-credit-1",
        currency: "CAD",
        balance: 0
    };

    it("can credit by valueId", async () => {
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
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 1000,
                    balanceChange: 1000
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            createdDate: null
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000);

        const getCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit-1", "GET");
        chai.assert.equal(getCreditResp.statusCode, 200, `body=${JSON.stringify(getCreditResp.body)}`);
        chai.assert.deepEqualExcluding(getCreditResp.body, postCreditResp.body, "statusCode");
    });

    it("409s on reusing a transaction ID", async () => {
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

    it("can simulate a credit by value ID", async () => {
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
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 2100,
                    balanceChange: 1100
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            createdDate: null,
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

    it("422s crediting without a transaction ID", async () => {
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

    it("422s crediting with an invalid transaction ID", async () => {
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

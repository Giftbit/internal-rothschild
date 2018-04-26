import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";
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

    const valueStore1: Partial<ValueStore> = {
        valueStoreId: "vs-credit-1",
        valueStoreType: "GIFTCARD",
        currency: "CAD",
        value: 0
    };

    it("can credit by valueStoreId", async () => {
        const postCurrencyResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(postCurrencyResp.statusCode, 201, `body=${JSON.stringify(postCurrencyResp.body)}`);

        const postValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${JSON.stringify(postValueStoreResp.body)}`);

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-1",
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            amount: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            transactionId: "credit-1",
            transactionType: "credit",
            remainder: 0,
            steps: [
                {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId,
                    valueStoreType: valueStore1.valueStoreType,
                    currency: valueStore1.currency,
                    codeLastFour: null,
                    customerId: null,
                    valueBefore: 0,
                    valueAfter: 1000,
                    valueChange: 1000
                }
            ]
        }, ["createdDate"]);

        const getValueStoreResp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${JSON.stringify(postValueStoreResp.body)}`);
        chai.assert.equal(getValueStoreResp.body.value, 1000);
    });

    it("409s on reusing a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-1",  // same as above
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            amount: 1350,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a credit by valueStoreId", async () => {
        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            transactionId: "credit-2",
            destination: {
                rail: "lightrail",
                valueStoreId: valueStore1.valueStoreId
            },
            amount: 1100,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postCreditResp.statusCode, 200, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            transactionId: "credit-2",
            transactionType: "credit",
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
                    valueAfter: 2100,
                    valueChange: 1100
                }
            ]
        }, ["createdDate"]);

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
            amount: 1500,
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
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("422s crediting without a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            destination: {
                rail: "lightrail",
                valueStoreId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s crediting with an invalid transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            transactionId: 123,
            destination: {
                rail: "lightrail",
                valueStoreId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });
});

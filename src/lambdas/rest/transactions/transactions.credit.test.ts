import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";

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

    it("can credit a gift card by valueStoreId", async () => {
        const postValueStoreResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStores", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(valueStore1)
        }));
        chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${postValueStoreResp.body}`);

        const postCreditResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/credit", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                transactionId: "credit-1",
                destination: {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId
                },
                value: 1000,
                currency: "CAD"
            })
        }));
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${postCreditResp.body}`);

        const postCreditBody = JSON.parse(postCreditResp.body);
        chai.assert.equal(postCreditBody.transactionId, "credit-1");
        chai.assert.equal(postCreditBody.transactionType, "credit");
        chai.assert.lengthOf(postCreditBody.steps, 1);
        chai.assert.equal(postCreditBody.steps[0].rail, "lightrail");
        chai.assert.equal(postCreditBody.steps[0].valueStoreId, valueStore1.valueStoreId);
        chai.assert.equal(postCreditBody.steps[0].valueStoreType, valueStore1.valueStoreType);
        chai.assert.equal(postCreditBody.steps[0].currency, valueStore1.currency);
        chai.assert.equal(postCreditBody.steps[0].valueBefore, 0);
        chai.assert.equal(postCreditBody.steps[0].valueAfter, 1000);
        chai.assert.equal(postCreditBody.steps[0].valueChange, 1000);

        const getValueStoreResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/valueStores/${valueStore1.valueStoreId}`, "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${postValueStoreResp.body}`);

        const getValueStoreBody = JSON.parse(getValueStoreResp.body) as ValueStore;
        chai.assert.equal(getValueStoreBody.value, 1000);
    });

    it("409s crediting by valueStoreId of the wrong currency", async () => {
        const postCreditResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/credit", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                transactionId: "credit-1",
                destination: {
                    rail: "lightrail",
                    valueStoreId: valueStore1.valueStoreId
                },
                value: 1500,
                currency: "USD"
            })
        }));
        chai.assert.equal(postCreditResp.statusCode, 409, `body=${postCreditResp.body}`);

        const postCreditBody = JSON.parse(postCreditResp.body);
        chai.assert.equal(postCreditBody.messageCode, "InvalidParty");
    });

    it("409s crediting a valueStoreId that does not exist", async () => {
        const postCreditResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/credit", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                transactionId: "credit-1",
                destination: {
                    rail: "lightrail",
                    valueStoreId: "idontexist"
                },
                value: 1500,
                currency: "USD"
            })
        }));
        chai.assert.equal(postCreditResp.statusCode, 409, `body=${postCreditResp.body}`);

        const postCreditBody = JSON.parse(postCreditResp.body);
        chai.assert.equal(postCreditBody.messageCode, "InvalidParty");
    });
});

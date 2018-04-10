import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";
import {ValueStore} from "../../../model/ValueStore";

describe("/v2/transactions", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    describe("/v2/transactions/credit", () => {
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
                },
                body: JSON.stringify(valueStore1)
            }));
            chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${postValueStoreResp.body}`);

            const getValueStoreBody = JSON.parse(getValueStoreResp.body) as ValueStore;
            chai.assert.equal(getValueStoreBody.value, 1000);
        });

        it("cannot credit a gift card by valueStoreId of the wrong currency", async () => {
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
    });

    describe("/v2/transactions/debit", () => {
        const valueStore1: Partial<ValueStore> = {
            valueStoreId: "vs-debit-1",
            valueStoreType: "GIFTCARD",
            currency: "CAD",
            value: 1000
        };

        it("can debit a gift card by valueStoreId", async () => {
            const postValueStoreResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStores", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserA.jwt}`
                },
                body: JSON.stringify(valueStore1)
            }));
            chai.assert.equal(postValueStoreResp.statusCode, 201, `body=${postValueStoreResp.body}`);

            const postDebitResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/debit", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserA.jwt}`
                },
                body: JSON.stringify({
                    transactionId: "debit-1",
                    source: {
                        rail: "lightrail",
                        valueStoreId: valueStore1.valueStoreId
                    },
                    value: -599,
                    currency: "CAD"
                })
            }));
            chai.assert.equal(postDebitResp.statusCode, 201, `body=${postDebitResp.body}`);

            const postCreditBody = JSON.parse(postDebitResp.body);
            chai.assert.equal(postCreditBody.transactionId, "debit-1");
            chai.assert.equal(postCreditBody.transactionType, "debit");
            chai.assert.lengthOf(postCreditBody.steps, 1);
            chai.assert.equal(postCreditBody.steps[0].rail, "lightrail");
            chai.assert.equal(postCreditBody.steps[0].valueStoreId, valueStore1.valueStoreId);
            chai.assert.equal(postCreditBody.steps[0].valueStoreType, valueStore1.valueStoreType);
            chai.assert.equal(postCreditBody.steps[0].currency, valueStore1.currency);
            chai.assert.equal(postCreditBody.steps[0].valueBefore, 1000);
            chai.assert.equal(postCreditBody.steps[0].valueAfter, 401);
            chai.assert.equal(postCreditBody.steps[0].valueChange, -599);

            const getValueStoreResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/valueStores/${valueStore1.valueStoreId}`, "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserA.jwt}`
                },
                body: JSON.stringify(valueStore1)
            }));
            chai.assert.equal(getValueStoreResp.statusCode, 200, `body=${postValueStoreResp.body}`);

            const getValueStoreBody = JSON.parse(getValueStoreResp.body) as ValueStore;
            chai.assert.equal(getValueStoreBody.value, 401);
        });

        it("cannot debit a gift card by valueStoreId of the wrong currency", async () => {
            const postCreditResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/debit", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserA.jwt}`
                },
                body: JSON.stringify({
                    transactionId: "credit-1",
                    source: {
                        rail: "lightrail",
                        valueStoreId: valueStore1.valueStoreId
                    },
                    value: -301,
                    currency: "USD"
                })
            }));
            chai.assert.equal(postCreditResp.statusCode, 409, `body=${postCreditResp.body}`);

            const postCreditBody = JSON.parse(postCreditResp.body);
            chai.assert.equal(postCreditBody.messageCode, "InvalidParty");
        });

        it("cannot debit a gift card by valueStoreId for more money than is contained", async () => {
            const postCreditResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/debit", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserA.jwt}`
                },
                body: JSON.stringify({
                    transactionId: "credit-1",
                    source: {
                        rail: "lightrail",
                        valueStoreId: valueStore1.valueStoreId
                    },
                    value: -1301,
                    currency: "USD"
                })
            }));
            chai.assert.equal(postCreditResp.statusCode, 409, `body=${postCreditResp.body}`);

            const postCreditBody = JSON.parse(postCreditResp.body);
            chai.assert.equal(postCreditBody.messageCode, "InvalidParty");
        });
    });
});

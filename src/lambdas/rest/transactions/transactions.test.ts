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
            const vsResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStores", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserA.jwt}`
                },
                body: JSON.stringify(valueStore1)
            }));
            chai.assert.equal(vsResp.statusCode, 201, `body=${vsResp.body}`);

            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/credit", "POST", {
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
            chai.assert.equal(resp.statusCode, 201, `body=${resp.body}`);

            const parsedBody = JSON.parse(resp.body);
            chai.assert.equal(parsedBody.transactionId, "credit-1");
            chai.assert.equal(parsedBody.transactionType, "credit");
            chai.assert.lengthOf(parsedBody.steps, 1);
            chai.assert.equal(parsedBody.steps[0].rail, "lightrail");
            chai.assert.equal(parsedBody.steps[0].valueStoreId, valueStore1.valueStoreId);
            chai.assert.equal(parsedBody.steps[0].valueStoreType, valueStore1.valueStoreType);
            chai.assert.equal(parsedBody.steps[0].currency, valueStore1.currency);
            chai.assert.equal(parsedBody.steps[0].valueBefore, 0);
            chai.assert.equal(parsedBody.steps[0].valueAfter, 1000);
            chai.assert.equal(parsedBody.steps[0].valueChange, 1000);
        });
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as valueStores from "./valueStores";
import * as testUtils from "../../testUtils";

describe("/v2/valueStores/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        valueStores.installValueStoresRest(router);
    });

    it("can list 0 valueStores", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStores", "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), {
            valueStores: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    let valueStore1: any = {
        valueStoreId: "1",
        valueStoreType: "GIFTCARD",
        currency: "USD",
        value: 5000
    };

    it("can create a valueStore", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStores", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(valueStore1)
        }));
        chai.assert.equal(resp.statusCode, 201, `body=${resp.body}`);

        const parsedBody = JSON.parse(resp.body);
        chai.assert.equal(parsedBody.userId, testUtils.testUserA.userId);
        chai.assert.equal(parsedBody.valueStoreId, valueStore1.valueStoreId);
        chai.assert.equal(parsedBody.valueStoreType, valueStore1.valueStoreType);
        chai.assert.equal(parsedBody.currency, valueStore1.currency);
        chai.assert.equal(parsedBody.value, valueStore1.value);
        chai.assert.equal(parsedBody.active, true);
        chai.assert.equal(parsedBody.expired, false);
        chai.assert.equal(parsedBody.frozen, false);
        chai.assert.equal(parsedBody.redemptionRule, null);
        chai.assert.equal(parsedBody.valueRule, null);
        chai.assert.equal(parsedBody.valueRule, null);
        valueStore1 = parsedBody;
    });

    it("409s on creating a duplicate valueStore", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStores", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(valueStore1)
        }));
        chai.assert.equal(resp.statusCode, 409);
    });
});

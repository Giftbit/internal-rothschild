import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as valueStores from "./valueStores";
import * as testUtils from "../../testUtils";
import {ValueStore} from "../../model/ValueStore";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/valueStores/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        valueStores.installValueStoresRest(router);
    });

    it("can list 0 valueStores", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/valueStores", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, {
            valueStores: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    let valueStore1: Partial<ValueStore> = {
        valueStoreId: "1",
        valueStoreType: "GIFTCARD",
        currency: "USD",
        value: 5000,
        discount: false
    };

    it("can create a value store", async () => {
        const resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, {
            ...valueStore1,
            uses: null,
            pretax: false,
            active: true,
            expired: false,
            frozen: false,
            startDate: null,
            endDate: null,
            redemptionRule: null,
            valueRule: null,
            metadata: null
        }, ["createdDate", "updatedDate"]);
        valueStore1 = resp.body;
    });

    it("can get the value store", async () => {
        const resp = await testUtils.testAuthedRequest<ValueStore>(router, `/v2/valueStores/${valueStore1.valueStoreId}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, valueStore1);
    });

    it("409s on creating a duplicate valueStore", async () => {
        const resp = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(resp.statusCode, 409);
    });
});

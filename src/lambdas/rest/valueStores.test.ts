import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../testUtils";
import {ValueStore} from "../../model/ValueStore";

import chaiExclude = require("chai-exclude");
import {Currency} from "../../model/Currency";
import {installRest} from "./index";
chai.use(chaiExclude);

describe("/v2/valueStores/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);
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

    const currency: Currency = {
        code: "USD",
        name: "Freedom dollars",
        symbol: "$",
        decimalPlaces: 2
    };

    let valueStore1: Partial<ValueStore> = {
        valueStoreId: "1",
        valueStoreType: "GIFTCARD",
        currency: "USD",
        value: 5000
    };

    it("requires the currency to exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CurrencyNotFound");
    });

    it("can create a value store", async () => {
        const resp1 = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const resp2 = await testUtils.testAuthedRequest<ValueStore>(router, "/v2/valueStores", "POST", valueStore1);
        chai.assert.equal(resp2.statusCode, 201, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.deepEqualExcluding(resp2.body, {
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
        valueStore1 = resp2.body;
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

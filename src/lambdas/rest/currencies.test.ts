import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as currencies from "./currencies";
import * as testUtils from "../../testUtils";
import {Currency} from "../../model/Currency";

import chaiExclude = require("chai-exclude");
chai.use(chaiExclude);

describe("/v2/currencies", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        currencies.installCurrenciesRest(router);
    });

    it("can list 0 currencies", async () => {
        const resp = await testUtils.testAuthedRequest<Currency[]>(router, "/v2/currencies", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
    });

    const funbux: Currency = {
        code: "FUNBUX",
        name: "Fun bux",
        symbol: "F$",
        decimalPlaces: 0
    };

    it("can create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", funbux);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, funbux);
    });

    it("can get the currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, funbux);
    });

    it("can list 1 currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency[]>(router, "/v2/currencies", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, [funbux]);
    });

    it("requires a code to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            code: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a name to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            name: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a symbol to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            symbol: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires decimalPlaces to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            decimalPlaces: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("404s on getting invalid currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/iamnotavalidcustomerid`, "GET");
        chai.assert.equal(resp.statusCode, 404);
    });

    it("can modify a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "PATCH", {
            name: funbux.name = "Funner buxes"
        });
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, funbux);

        const resp2 = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "GET");
        chai.assert.equal(resp2.statusCode, 200);
        chai.assert.deepEqual(resp2.body, funbux);
    });

    it("can delete an unused currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "DELETE");
        chai.assert.equal(resp.statusCode, 200);

        const resp2 = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "GET");
        chai.assert.equal(resp2.statusCode, 404);
    });
});

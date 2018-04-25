import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "./transactions";
import * as valueStores from "../valueStores";
import * as testUtils from "../../../testUtils";

describe("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValueStoresRest(router);
    });

    it("can retrieve 0 transactions", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, {
            transactions: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });
});
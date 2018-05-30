import * as testUtils from "../../testUtils";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import {Program} from "../../model/Program";
import {installRest} from "./index";

describe.skip("/v2/programs", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);
    });

    it("can list 0 programs", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/programs", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, {
            valueTemplates: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    let program1: Partial<Program> = {
        id: "1",
        currency: "USD"
    };

    it("can create a program", async () => {
        const resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program1);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.equal(resp.body.id, program1.id);
        chai.assert.equal(resp.body.currency, program1.currency);
        chai.assert.isNotNull(resp.body.createdDate);
        chai.assert.isNotNull(resp.body.updatedDate);
        program1 = resp.body;
    });

    it("can get the program", async () => {
        const resp = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${program1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, program1);
    });

    it("can update a program", async () => {
        let valueTemplate1Update = {...program1};
        valueTemplate1Update.currency = "FUN_BUCKS";
        const resp = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${program1.id}`, "PUT", valueTemplate1Update);
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.id, valueTemplate1Update.id);
        chai.assert.equal(resp.body.currency, valueTemplate1Update.currency);
        chai.assert.isNotNull(resp.body.createdDate);
        chai.assert.isNotNull(resp.body.updatedDate);
    });

    it("can delete a program", async () => {
        const deleteResp = await testUtils.testAuthedRequest(router, `/v2/programs/${program1.id}`, "DELETE");
        chai.assert.equal(deleteResp.statusCode, 200);

        const getResp = await testUtils.testAuthedRequest(router, `/v2/programs/${program1.id}`, "GET");
        chai.assert.equal(getResp.statusCode, 404);
    });
});

import * as testUtils from "../../testUtils";
import * as valueStoreTemplates from "./valueStoreTemplates";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import {ValueStoreTemplate} from "../../model/ValueStoreTemplate";

describe("/v2/valueStoreTemplate/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        valueStoreTemplates.installValueStoreTemplatesRest(router);
    });

    it("can list 0 ValueStoreTemplates", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/valueStoreTemplates", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, {
            valueStoreTemplates: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    let valueStoreTemplate1: Partial<ValueStoreTemplate> = {
        valueStoreTemplateId: "1",
        currency: "USD",
        valueStoreType: "PREPAID"
    };

    it("can create a ValueStoreTemplate", async () => {
        const resp = await testUtils.testAuthedRequest<ValueStoreTemplate>(router, "/v2/valueStoreTemplates", "POST", valueStoreTemplate1);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.equal(resp.body.valueStoreTemplateId, valueStoreTemplate1.valueStoreTemplateId);
        chai.assert.equal(resp.body.currency, valueStoreTemplate1.currency);
        chai.assert.equal(resp.body.valueStoreType, valueStoreTemplate1.valueStoreType);
        chai.assert.isNotNull(resp.body.createdDate);
        chai.assert.isNotNull(resp.body.updatedDate);
        valueStoreTemplate1 = resp.body;
    });

    it("can get the ValueStoreTemplate", async () => {
        const resp = await testUtils.testAuthedRequest<ValueStoreTemplate>(router, `/v2/valueStoreTemplates/${valueStoreTemplate1.valueStoreTemplateId}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, valueStoreTemplate1);
    });

    it("can update a ValueStoreTemplate", async () => {
        let valueStoreTemplate1Update = {...valueStoreTemplate1};
        valueStoreTemplate1Update.currency = "FUN_BUCKS";
        const resp = await testUtils.testAuthedRequest<ValueStoreTemplate>(router, `/v2/valueStoreTemplates/${valueStoreTemplate1.valueStoreTemplateId}`, "PUT", valueStoreTemplate1Update);
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.valueStoreTemplateId, valueStoreTemplate1Update.valueStoreTemplateId);
        chai.assert.equal(resp.body.currency, valueStoreTemplate1Update.currency);
        chai.assert.equal(resp.body.valueStoreType, valueStoreTemplate1Update.valueStoreType);
        chai.assert.isNotNull(resp.body.createdDate);
        chai.assert.isNotNull(resp.body.updatedDate);
    });

    it("can delete a ValueStoreTemplate", async () => {
        const deleteResp = await testUtils.testAuthedRequest(router, `/v2/valueStoreTemplates/${valueStoreTemplate1.valueStoreTemplateId}`, "DELETE");
        chai.assert.equal(deleteResp.statusCode, 200);

        const getResp = await testUtils.testAuthedRequest(router, `/v2/valueStoreTemplates/${valueStoreTemplate1.valueStoreTemplateId}`, "GET");
        chai.assert.equal(getResp.statusCode, 404);
    });
});

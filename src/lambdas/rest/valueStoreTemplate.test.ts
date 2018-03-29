import * as testUtils from "../../testUtils";
import * as valueStoreTemplates from "./valueStoreTemplate";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import {ValueStoreTemplate} from "../../model/ValueStoreTemplate";
import {ValueStoreType} from "../../model/ValueStore";

describe("/v2/valueStoreTemplate/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        valueStoreTemplates.installValueStoreTemplatesRest(router);
    });

    it("can list 0 ValueStoreTemplates", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStoreTemplates", "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), {
            valueStoreTemplates: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    let valueStoreTemplate1: ValueStoreTemplate = {
        valueStoreTemplateId: "1",
        currency: "USD",
        valueStoreType: "PREPAID"
    };

    it("can create a ValueStoreTemplate", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/valueStoreTemplates", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(valueStoreTemplate1)
        }));
        chai.assert.equal(resp.statusCode, 201);

        const parsedBody = JSON.parse(resp.body);
        chai.assert.equal(parsedBody.userId, testUtils.testUserA.userId);
        chai.assert.equal(parsedBody.valueStoreTemplateId, valueStoreTemplate1.valueStoreTemplateId);
        chai.assert.equal(parsedBody.currency, valueStoreTemplate1.currency);
        chai.assert.equal(parsedBody.valueStoreType, valueStoreTemplate1.valueStoreType);
        chai.assert.isNotNull(parsedBody.createdDate);
        chai.assert.isNotNull(parsedBody.update());
        valueStoreTemplate1 = parsedBody;
    });

    it("can get the ValueStoreTemplate", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/valueStoreTemplates/${valueStoreTemplate1.valueStoreTemplateId}`, "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), valueStoreTemplate1);
    });
});
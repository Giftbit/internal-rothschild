import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Contact} from "../../model/Contact";
import {installRestRoutes} from "./installRestRoutes";
import * as testUtils from "../../testUtils";
import {createContact} from "./contacts";
import {Currency} from "../../model/Currency";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {describe, it, before} from "mocha";

describe("/v2/contacts/values", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);
    });

    const currency: Currency = {
        code: "AUD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Dollarydoo"
    };

    const contact: Contact = {
        id: "c-1",
        firstName: null,
        lastName: null,
        email: null,
        metadata: null,
        createdDate: new Date(),
        updatedDate: new Date()
    };

    let value1: Partial<Value> = {
        id: "add-unique-by-id",
        currency: currency.code
    };

    it("can add a unique Value by valueId", async () => {
        await createCurrency(testUtils.defaultTestUser.auth, currency);
        await createContact(testUtils.defaultTestUser.auth, contact);

        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(resp1.statusCode, 200);
        value1 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {valueId: value1.id});
        chai.assert.equal(resp2.statusCode, 200);
        chai.assert.equal(resp2.body.id, value1.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
    });

    let value2: Partial<Value> = {
        id: "add-unique-by-id",
        currency: currency.code,
        code: "be1c8ee3-7038-4b48-b941-e0575206b0b5"
    };

    it("can add a unique Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(resp1.statusCode, 200);
        value2 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {code: value2.code});
        chai.assert.equal(resp2.statusCode, 200);
        chai.assert.equal(resp2.body.id, value2.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, `…${value2.code.slice(-4)}`);
    });

    it("can list the 2 unique values added to a contact", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
        chai.assert.equal(resp1.statusCode, 200);
        chai.assert.sameDeepMembers(resp1.body, [value1, value2]);
    });

    it.skip("can add a generic Value by valueId", async () => {

    });

    it.skip("can add a generic Value by code", async () => {

    });

    it.skip("can list values added to a contact", async () => {

    });
});

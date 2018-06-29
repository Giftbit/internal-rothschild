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

describe.only("/v2/contacts/values", () => {

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

    let value1: Value;

    it("can add a code-less Value by valueId", async () => {
        await createCurrency(testUtils.defaultTestUser.auth, currency);
        await createContact(testUtils.defaultTestUser.auth, contact);

        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-code-less-by-id",
            currency: currency.code
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value1 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {valueId: value1.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value1.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        value1.contactId = contact.id;
    });

    const value2GenericCode = "GETONUP";
    let value2: Value;

    it("can add a generic-code Value by valueId", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-by-id",
            currency: currency.code,
            genericCode: value2GenericCode
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value2 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {valueId: value2.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value2.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, value2.code);
        value2.contactId = contact.id;
    });

    const value3GenericCode = "GETONDOWN";
    let value3: Value;

    it("can add a generic-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-by-code",
            currency: currency.code,
            genericCode: value3GenericCode
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value3 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {code: value3GenericCode});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value3.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, value3.code);
        value3.contactId = contact.id;
    });

    const value4UniqueCode = "DROPITLIKEITSHOT";
    let value4: Value;

    it("can add a unique-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-unique-by-id",
            currency: currency.code,
            code: value4UniqueCode
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value4 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {valueId: value4.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value4.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, `…${value4UniqueCode.slice(-4)}`);
        value4.contactId = contact.id;
    });

    const value5UniqueCode = "ANDPICKITBACKUP";
    let value5: Value;

    it("can add a unique-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-unique-by-code",
            currency: currency.code,
            code: value5UniqueCode
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value5 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {code: value5UniqueCode});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value5.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, `…${value5UniqueCode.slice(-4)}`);
        value5.contactId = contact.id;
    });

    let value6: Value;

    it("can add a unique-generated-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generated-by-code",
            currency: currency.code,
            generateCode: {
                length: 12
            }
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value6 = resp1.body;

        const resp2 =  await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value6.id}?showCode=true`, "GET");
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        const code = resp2.body.code;

        const resp3 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/add`, "POST", {code});
        chai.assert.equal(resp3.statusCode, 200, `body=${JSON.stringify(resp3.body)}`);
        chai.assert.equal(resp3.body.id, value6.id);
        chai.assert.equal(resp3.body.contactId, contact.id);
        chai.assert.equal(resp3.body.code, `…${code.slice(-4)}`);
        value6.contactId = contact.id;
    });

    it("can list values added to a contact", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
        chai.assert.equal(resp1.statusCode, 200, `body=${JSON.stringify(resp1.body)}`);
        chai.assert.sameDeepMembers(resp1.body, [value1, value2, value3, value4, value5, value6]);
    });
});

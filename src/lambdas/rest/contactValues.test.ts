import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Contact} from "../../model/Contact";
import {installRestRoutes} from "./installRestRoutes";
import * as testUtils from "../../utils/testUtils";
import {createContact} from "./contacts";
import {Currency} from "../../model/Currency";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils";

describe("/v2/contacts/values", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);
        await initializeCodeCryptographySecrets(Promise.resolve({
            encryptionSecret: "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea",
            lookupHashSecret: "ae8645165cc7533dbcc84aeb21c7d6553a38271b7e3402f99d16b8a8717847e1"
        }));
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

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value1.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value1.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        value1.contactId = contact.id;
    });

    let value2: Value;

    it("can add a generic-code Value by valueId", async () => {
        const code = "GETONUP";
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-by-id",
            currency: currency.code,
            valueRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: code,
            isGenericCode: true,
            uses: null
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        // Should return a new Value.
        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: resp1.body.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.currency, resp1.body.currency);
        chai.assert.deepEqual(resp2.body.valueRule, resp1.body.valueRule);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.uses, 1);
        chai.assert.equal(resp2.body.code, null);
        chai.assert.equal(resp2.body.isGenericCode, null);
        chai.assert.notEqual(resp2.body.id, resp1.body.id);
        value2 = resp2.body;
    });

    const value3Code = "GETONDOWN";
    let value3: Value;

    it("can add a generic-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-by-code",
            currency: currency.code,
            valueRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: value3Code,
            isGenericCode: true,
            uses: 20
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        // Should return a new Value.
        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value3Code});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.currency, resp1.body.currency);
        chai.assert.deepEqual(resp2.body.valueRule, resp1.body.valueRule);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.uses, 1);
        chai.assert.equal(resp2.body.code, null);
        chai.assert.equal(resp2.body.isGenericCode, null);
        chai.assert.notEqual(resp2.body.id, resp1.body.id);
        value3 = resp2.body;

        // uses should be decremented on original Value.
        const resp3 = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${resp1.body.id}`, "GET");
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp3.body)}`);
        chai.assert.equal(resp3.body.uses, 19);
    });

    it("a Contact cannot claim a generic-code Value twice", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value3Code});
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueAlreadyClaimed");
    });

    it("cannot add a generic-code Value with 0 uses remaining", async () => {
        const code = "PARTYPEOPLE";
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "generic-value-with-0-uses",
            currency: currency.code,
            valueRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: code,
            isGenericCode: true,
            uses: 0
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const resp2 = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: code});
        chai.assert.equal(resp2.statusCode, 409, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "InsufficientUses");
    });

    const value4Code = "DROPITLIKEITSHOT";
    let value4: Value;

    it("can add a unique-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-unique-by-id",
            currency: currency.code,
            code: value4Code
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value4 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value4.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value4.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, `…${value4Code.slice(-4)}`);
        value4.contactId = contact.id;
    });

    const value5Code = "ANDPICKITBACKUP";
    let value5: Value;

    it("can add a unique-code Value by code", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-unique-by-code",
            currency: currency.code,
            code: value5Code
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value5 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value5Code});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value5.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.equal(resp2.body.code, `…${value5Code.slice(-4)}`);
        value5.contactId = contact.id;
    });

    let value6Code: string;
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
        value6Code = resp2.body.code;

        const resp3 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value6Code});
        chai.assert.equal(resp3.statusCode, 200, `body=${JSON.stringify(resp3.body)}`);
        chai.assert.equal(resp3.body.id, value6.id);
        chai.assert.equal(resp3.body.contactId, contact.id);
        chai.assert.equal(resp3.body.code, `…${value6Code.slice(-4)}`);
        value6.contactId = contact.id;
    });

    it("can list values added to a contact", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
        chai.assert.equal(resp1.statusCode, 200, `body=${JSON.stringify(resp1.body)}`);
        chai.assert.sameDeepMembers(resp1.body, [value1, value2, value3, value4, value5, value6]);
    });

    it("can list values added to a contact with showCode = true", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values?showCode=true`, "GET");
        chai.assert.equal(resp1.statusCode, 200, `body=${JSON.stringify(resp1.body)}`);

        chai.assert.isObject(resp1.body.find(v => v.code === value4Code), "find a Value with decrypted value4Code");
        chai.assert.isObject(resp1.body.find(v => v.code === value5Code), "find a Value with decrypted value5Code");
        chai.assert.isObject(resp1.body.find(v => v.code === value6Code), "find a Value with decrypted value6Code");
    });
});

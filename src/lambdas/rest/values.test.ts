import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../testUtils";
import {createCurrency} from "../../testUtils";
import {DbValue, Value} from "../../model/Value";
import {Currency} from "../../model/Currency";
import {installRest} from "./index";
import {Contact} from "../../model/Contact";
import {getKnexRead} from "../../dbUtils/connection";
import {computeLookupHash, encrypt} from "../../services/codeCryptoUtils";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/values/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);
        createCurrency(router, "USD");
    });

    it("can list 0 values", async () => {
        const resp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    it("can list 0 values in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Value>(router, "/v2/values", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    let value1: Partial<Value> = {
        id: "1",
        currency: "USD",
        balance: 0
    };

    it("cannot create a value with missing currency", async () => {
        let valueWithMissingCurrency: Partial<Value> = {
            id: "1",
            currency: "IDK",
            balance: 0
        };

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", valueWithMissingCurrency);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CurrencyNotFound");
    });

    it("can create a value with no code, no contact, no program", async () => {
        const resp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(resp2.statusCode, 201, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.deepEqualExcluding(resp2.body, {
            ...value1,
            uses: null,
            programId: null,
            contactId: null,
            code: null,
            active: true,
            canceled: false,
            frozen: false,
            pretax: false,
            startDate: null,
            endDate: null,
            redemptionRule: null,
            valueRule: null,
            discount: false,
            metadata: null
        }, ["createdDate", "updatedDate"]);
        value1 = resp2.body;
    });

    it("can get the value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, value1);
    });

    it("409s on creating a duplicate value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: value1.id,
            currency: value1.currency,
            balance: value1.balance
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot change a value's currency", async () => {
        const currency2: Currency = {
            code: "XYZZY",
            name: "XYZZY",
            symbol: "X",
            decimalPlaces: 0
        };

        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency2);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const resp2 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {currency: currency2.code});
        chai.assert.equal(resp2.statusCode, 422, `body=${JSON.stringify(resp2.body)}`);
    });

    it("cannot change a value's balance", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {balance: 123123});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("cannot change a value's uses", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {uses: 100});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("can change the startDate and endDate", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {
            startDate: new Date("2077-01-01"),
            endDate: new Date("2277-01-01")
        });
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.startDate = new Date("2077-01-01").toISOString() as any;
        value1.endDate = new Date("2277-01-01").toISOString() as any;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can change the metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {
            metadata: {
                special: "snowflake"
            }
        });
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.metadata = {
            special: "snowflake"
        };
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can freeze a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {frozen: true});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.frozen = true;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can unfreeze a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {frozen: false});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.frozen = false;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("can cancel a value", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "PATCH", {canceled: true});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        value1.canceled = true;
        chai.assert.deepEqualExcluding(resp.body, value1, ["updatedDate"]);
    });

    it("cannot uncancel a value", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value1.id}`, "PATCH", {canceled: false});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CannotUncancelValue");
    });

    let contact1: Partial<Contact> = {
        id: "c1",
    };

    let value2: Partial<Value> = {
        id: "v2",
        currency: "USD",
        balance: 0,
        contactId: contact1.id
    };

    it("can create a value attached to a contact", async () => {
        const resp1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact1);
        chai.assert.equal(resp1.statusCode, 201);

        const resp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(resp2.statusCode, 201, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.contactId, value2.contactId);
        value2 = resp2.body;
    });

    let value3: Partial<Value> = {
        id: "v3",
        currency: "USD",
        balance: 5000
    };

    it.skip("can create a value with an initial balance", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value3);
        chai.assert.equal(resp.statusCode, 201, `create body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.balance, value3.balance);
        value3 = resp.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/transactions/${value2.id}-fund`, "GET");
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
    });

    let value4: Partial<Value> = {
        id: "v4",
        currency: "USD",
        balance: 0,
        contactId: "idontexist"
    };

    it("409s on creating a value attached to a non-existent contact", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value4);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ContactNotFound");
    });

    it("can delete a value that is not in use", async () => {
        const value: Partial<Value> = {
            id: "vjeff",
            currency: "USD",
            balance: 0
        };

        const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp1.statusCode, 201, `create body=${JSON.stringify(resp1.body)}`);

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "DELETE");
        chai.assert.equal(resp3.statusCode, 200, `delete body=${JSON.stringify(resp3.body)}`);

        const resp4 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(resp4.statusCode, 404, `get deleted body=${JSON.stringify(resp4.body)}`);
    });

    let value5: Partial<Value> = {
        id: "vjeff2",
        currency: "USD",
        balance: 1982   // creates an initial value transaction
    };

    it.skip("409s on deleting a value that is in use", async () => {
        const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value5);
        chai.assert.equal(resp1.statusCode, 201, `create body=${JSON.stringify(resp1.body)}`);
        value5 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value5.id}`, "DELETE");
        chai.assert.equal(resp2.statusCode, 409, `delete body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueInUse");

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value5.id}`, "GET");
        chai.assert.equal(resp3.statusCode, 200, `still exists body=${JSON.stringify(resp3.body)}`);
    });

    it.only("can create a value with public code", async () => {
        let valueWithPublicCode: Partial<Value> = {
            id: "valueWithPublicCode",
            currency: "USD",
            code: "PUBLICCODE",
            balance: 0
        };

        const resp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
        chai.assert.equal(resp2.statusCode, 201, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.code, valueWithPublicCode.code);

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: valueWithPublicCode.id
            });
        console.log(JSON.stringify(res, null, 4));
    });

    it.only("can create a value with secure code", async () => {
        let valueWithPublicCode = {
            id: "valueWithSecureCode",
            currency: "USD",
            secureCode: "SECURECODE",
            balance: 0
        };

        const respPost = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithPublicCode);
        chai.assert.equal(respPost.statusCode, 201, `body=${JSON.stringify(respPost.body)}`);
        chai.assert.equal(respPost.body.code, "...CODE");

        const respGet = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueWithPublicCode.id}`, "GET");
        chai.assert.equal(respGet.statusCode, 200, `body=${JSON.stringify(respGet.body)}`);
        chai.assert.equal(respPost.body.code, "...CODE");

        const respGetDisplaySecure = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueWithPublicCode.id}?displaySecure=true`, "GET");
        chai.assert.equal(respGetDisplaySecure.statusCode, 200, `body=${JSON.stringify(respGetDisplaySecure.body)}`);
        chai.assert.equal(respGetDisplaySecure.body.code, "SECURECODE");
        console.log(JSON.stringify(respGetDisplaySecure));

        const knex = await getKnexRead();
        const res: DbValue[] = await knex("Values")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: valueWithPublicCode.id
            });
        const encryptedCode: string = encrypt("SECURECODE");
        console.log("encryptedCode here: " + encryptedCode);
        console.log("encryptedCode from response: " + res[0].encryptedCode);
        chai.assert.isNotNull(res[0].encryptedCode);
        chai.assert.isNotNull(res[0].codeHashed);
        chai.assert.equal(res[0].codeHashed, computeLookupHash("SECURECODE", testUtils.defaultTestUser.auth));
        chai.assert.equal(respPost.body.code, "...CODE");

        const list = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "GET");
        console.log("list\n" + JSON.stringify(list.body, null, 4));
        const listDisplaySecure = await testUtils.testAuthedRequest<Value>(router, `/v2/values?displaySecure=true`, "GET");
        console.log("listDisplaySecure\n" + JSON.stringify(listDisplaySecure.body, null, 4));
    });


});

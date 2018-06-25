import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as parseLinkHeader from "parse-link-header";
import * as testUtils from "../../testUtils";
import {DbValue, Value} from "../../model/Value";
import {Currency} from "../../model/Currency";
import {Contact} from "../../model/Contact";
import chaiExclude = require("chai-exclude");
import {defaultTestUser} from "../../testUtils";
import {getKnexRead, getKnexWrite} from "../../dbUtils/connection";
import {LightrailTransactionStep, Transaction} from "../../model/Transaction";
import {installRestRoutes} from "./installRestRoutes";

chai.use(chaiExclude);

describe("/v2/values/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);
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

    const currency: Currency = {
        code: "USD",
        name: "Freedom dollars",
        symbol: "$",
        decimalPlaces: 2
    };

    let value1: Partial<Value> = {
        id: "1",
        currency: "USD",
        balance: 0
    };

    it("cannot create a value with missing currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value1);
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CurrencyNotFound");
    });

    it("can create a value with no code, no contact, no program", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

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

    it("can create a value with an initial balance", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value3);
        chai.assert.equal(resp.statusCode, 201, `create body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.balance, value3.balance);
        value3 = resp.body;

        const resp2 = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${value3.id}`, "GET");
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.transactionType, "credit");
        chai.assert.equal(resp2.body.currency, value3.currency);
        chai.assert.lengthOf(resp2.body.steps, 1);
        chai.assert.equal(resp2.body.steps[0].rail, "lightrail");
        chai.assert.deepEqual((resp2.body.steps[0] as LightrailTransactionStep), {
            rail: "lightrail",
            valueId: value3.id,
            code: null,
            contactId: null,
            balanceBefore: 0,
            balanceAfter: value3.balance,
            balanceChange: value3.balance
        });
    });

    it("422s on creating a value with a negative balance", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {id: "negativebalance", currency: "USD", balance: -5000});
        chai.assert.equal(resp.statusCode, 422, `create body=${JSON.stringify(resp.body)}`);
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

    it("404s on deleting a Value that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/values/idonotexist`, "DELETE");
        chai.assert.equal(resp.statusCode, 404, `delete body=${JSON.stringify(resp.body)}`);
    });

    let value5: Partial<Value> = {
        id: "vjeff2",
        currency: "USD",
        balance: 1982   // creates an initial value transaction
    };

    it("409s on deleting a Value that is in use", async () => {
        const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value5);
        chai.assert.equal(resp1.statusCode, 201, `create body=${JSON.stringify(resp1.body)}`);
        value5 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value5.id}`, "DELETE");
        chai.assert.equal(resp2.statusCode, 409, `delete body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.messageCode, "ValueInUse");

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value5.id}`, "GET");
        chai.assert.equal(resp3.statusCode, 200, `still exists body=${JSON.stringify(resp3.body)}`);
    });

    describe("filtering and paging", () => {
        before(async () => {
            const values: Partial<DbValue>[] = [];
            const date = new Date();

            for (let i = 0; i < 1000; i++) {
                values.push({
                    userId: defaultTestUser.userId,
                    id: `paging-${i}`,
                    currency: "USD",
                    balance: Math.max((Math.sin(i) * 1000) | 0, 0),
                    pretax: true,
                    active: true,
                    canceled: !(i % 7),
                    frozen: false,
                    discount: true,
                    startDate: date,
                    endDate: date,
                    createdDate: date,
                    updatedDate: date
                });
            }

            const knex = await getKnexWrite();
            await knex("Values").insert(values);
        });

        it("pages and filters through many Values", async () => {
            const knex = await getKnexRead();
            const expected = await knex("Values")
                .where({
                    userId: defaultTestUser.userId,
                    canceled: false
                })
                .where("balance", ">", 200)
                .orderBy("id");
            chai.assert.isAtLeast(expected.length, 2, "expect results");

            const page1Size = Math.ceil(expected.length / 2);
            const page1 = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/values?canceled=false&balance.gt=200&limit=${page1Size}`, "GET");
            chai.assert.equal(page1.statusCode, 200, `body=${JSON.stringify(page1.body)}`);
            chai.assert.deepEqual(page1.body.map(v => v.id), expected.slice(0, page1Size).map(v => v.id), "the same ids in the same order");
            chai.assert.equal(page1.headers["Limit"], `${page1Size}`);
            chai.assert.equal(page1.headers["Max-Limit"], "1000");
            chai.assert.isDefined(page1.headers["Link"]);

            const page1Link = parseLinkHeader(page1.headers["Link"]);
            const page2 = await testUtils.testAuthedRequest<Contact[]>(router, page1Link.next.url, "GET");
            chai.assert.equal(page2.statusCode, 200, `url=${page1Link.next.url} body=${JSON.stringify(page2.body)}`);
            chai.assert.deepEqual(page2.body.map(v => v.id), expected.slice(page1Size).map(v => v.id), "the same ids in the same order");
            chai.assert.equal(page1.headers["Limit"], `${page1Size}`);
            chai.assert.equal(page1.headers["Max-Limit"], "1000");
            chai.assert.isDefined(page1.headers["Link"]);

            const page2Link = parseLinkHeader(page2.headers["Link"]);
            const page2prev = await testUtils.testAuthedRequest<Contact[]>(router, page2Link.prev.url, "GET");
            chai.assert.equal(page2prev.statusCode, 200, `url=${page2Link.prev.url} body=${JSON.stringify(page2prev.body)}`);
            chai.assert.deepEqual(page2prev.body, page1.body);
        });

        it("supports id.in", async () => {
            const ids = ["paging-1", "paging-10", "paging-11", "paging-101", "paging-100", "paging-110", "paging-111"];

            const knex = await getKnexRead();
            const expected = await knex("Values")
                .where({
                    userId: defaultTestUser.userId
                })
                .whereIn("id", ids)
                .orderBy("id");

            const page1 = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/values?id.in=${ids.join(",")}`, "GET");
            chai.assert.equal(page1.statusCode, 200, `body=${JSON.stringify(page1.body)}`);
            chai.assert.deepEqualExcludingEvery(page1.body, expected, ["userId", "codeHashed", "codeLastFour", "startDate", "endDate", "createdDate", "updatedDate"]);
            chai.assert.isDefined(page1.headers["Link"]);
        });
    });
});

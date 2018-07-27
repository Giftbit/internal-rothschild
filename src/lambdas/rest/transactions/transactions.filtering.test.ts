import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../utils/testUtils";
import * as currencies from "../currencies";
import {Transaction} from "../../../model/Transaction";
import {Value} from "../../../model/Value";
import {installRestRoutes} from "../installRestRoutes";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe.only("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);
    });

    beforeEach(async function () {
        await testUtils.resetDb();
        await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
        await currencies.createCurrency(defaultTestUser.auth, {
            code: "USD",
            name: "US Donairs",
            symbol: "D",
            decimalPlaces: 2
        });
    });

    it("test filter by valueId", async () => {
        const valueA = {
            id: generateId(),
            currency: "USD",
            balance: 10
        };
        let createdValues: Value[] = [];
        for (let i = 0; i < 3; i++) {
            const newValue = {
                id: generateId(),
                currency: "CAD",
                balance: 10 + i
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", newValue);
            console.log(JSON.stringify(createValue));
            chai.assert.equal(createValue.statusCode, 201);
            createdValues.push(createValue.body);
        }

        const resp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${createdValues[0].id}`, "GET");
        chai.assert.equal(resp.body.length, 1);
    });

    it("test user isolation with filtering queries", async () => {
        // user 1
        const value1User1 = {
            id: generateId(),
            currency: "USD",
            balance: 10
        };
        const value2User1 = {
            id: generateId(),
            currency: "USD",
            balance: 10
        };
        const createValue1User1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1User1);
        chai.assert.equal(createValue1User1.statusCode, 201);
        const createValue2User1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2User1);
        chai.assert.equal(createValue2User1.statusCode, 201);

        // user 2
        const valueUser2 = {
            id: generateId(),
            currency: "USD",
            balance: 10
        };
        const createValue2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
            },
            body: JSON.stringify(valueUser2)
        }));
        JSON.stringify("HERE: " + createValue2);
        chai.assert.equal(createValue2.statusCode, 201);

        const listTransactions = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions`, "GET");
        chai.assert.equal(listTransactions.body.length, 2);
        console.log(JSON.stringify(listTransactions, null, 4));

        const filterForValue1 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value1User1.id}`, "GET");
        chai.assert.equal(filterForValue1.body.length, 1);
        console.log(JSON.stringify(filterForValue1, null, 4));
        // chai.assert.equal(filterForValue1.body[0].id, value1User1.id);
    });

    // describe.skip("filter transactions by query params", () => {
    //     it("can filter by type", async () => {
    //         const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions?transactionType=transfer", "GET");
    //         chai.assert.equal(resp.statusCode, 200);
    //         chai.assert.equal(resp.body.length, 1);
    //         chai.assert.equal(resp.body[0].id, transfer1.id);
    //     });
    //
    //     it("can filter by minCreatedDate", async () => {
    //         const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions?minCreatedDate=2018-01-01", "GET");
    //         chai.assert.equal(resp.statusCode, 200);
    //         chai.assert.equal(resp.body.length, 3);
    //         chai.assert.equal(resp.body[0].id, transfer1.id);
    //         chai.assert.equal(resp.body[1].id, debit1.id);
    //     });
    //
    //     it("can filter by maxCreatedDate", async () => {
    //         const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions?maxCreatedDate=2018-01-01", "GET");
    //         chai.assert.equal(resp.statusCode, 200);
    //         chai.assert.equal(resp.body.length, 0);
    //     });
    //
    //     it("can filter by three params", async () => {
    //         const knex = await getKnexWrite();
    //         await knex("Transactions").insert(transfer2);
    //         await knex("Transactions").insert(transfer3);
    //
    //         const resp = await testUtils.testAuthedRequest<any>(router, `/v2/transactions?transactionType=transfer&minCreatedDate=${new Date("01 January 2002").toISOString()}&maxCreatedDate=${new Date("01 January 2006").toISOString()}`, "GET");
    //
    //         chai.assert.equal(resp.statusCode, 200);
    //         chai.assert.equal(resp.body.length, 1);
    //         chai.assert.include(resp.body[0].id, transfer3.id);
    //     });
});

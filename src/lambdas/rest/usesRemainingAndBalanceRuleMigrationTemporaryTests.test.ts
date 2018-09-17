import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Program} from "../../model/Program";
import {Issuance} from "../../model/Issuance";
import {Rule, Value} from "../../model/Value";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

/**
 * This is a temporary test. It can be deleted once valueRule, uses,
 * and fixedInitialUsesRemaining have been removed from the API.
 * It only needs to exist in the interim while the API is still accepting
 * and responding with both the new and deprecated properties.
 */
describe("/v2/values/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("can create a Value with deprecated properties `uses` and `valueRule` and both properties are returned", async () => {
        const balanceRule: Rule = {
            rule: "500",
            explanation: "a hard $5"
        };
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            uses: 1,
            valueRule: balanceRule
        };
        const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
        chai.assert.equal(post.body.uses, 1);
        chai.assert.equal(post.body.usesRemaining, 1);
        chai.assert.deepEqual(post.body.valueRule, balanceRule);
        chai.assert.deepEqual(post.body.balanceRule, balanceRule);

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(get.statusCode, 200, `body=${JSON.stringify(get.body)}`);
        chai.assert.equal(get.body.uses, 1);
        chai.assert.equal(get.body.usesRemaining, 1);
        chai.assert.deepEqual(get.body.valueRule, balanceRule);
        chai.assert.deepEqual(get.body.balanceRule, balanceRule);

        const list = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values`, "GET");
        chai.assert.equal(list.statusCode, 200, `body=${JSON.stringify(list.body)}`);
        chai.assert.equal(list.body[0].uses, 1);
        chai.assert.equal(list.body[0].usesRemaining, 1);
        chai.assert.deepEqual(list.body[0].valueRule, balanceRule);
        chai.assert.deepEqual(list.body[0].balanceRule, balanceRule);
    });

    it("can create a Value with new properties `usesRemaining` and `balanceRule` and both properties are returned", async () => {
        const balanceRule: Rule = {
            rule: "500",
            explanation: "a hard $5"
        };
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            usesRemaining: 1,
            balanceRule: balanceRule
        };
        const res = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(res.statusCode, 201, `body=${JSON.stringify(res.body)}`);
        chai.assert.equal(res.body.uses, 1);
        chai.assert.equal(res.body.usesRemaining, 1);
        chai.assert.deepEqual(res.body.valueRule, balanceRule);
        chai.assert.deepEqual(res.body.balanceRule, balanceRule);
    });

    describe("check using deprecated properties (valueRule, fixedInitialUses, uses) for program creation, one-off value creation, and issuance creation", () => {

        let program: Program;
        it("can create a Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {
            const request: Partial<Program> = {
                id: generateId(),
                currency: "USD",
                name: "name",
                fixedInitialUses: [1, 2, 3],
                valueRule: {
                    rule: "500",
                    explanation: "a hard $5"
                }
            };
            const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
            chai.assert.equal(res.statusCode, 201);
            chai.assert.deepEqual(res.body.balanceRule, request.valueRule);
            chai.assert.deepEqual(res.body.valueRule, request.valueRule);
            chai.assert.deepEqual(res.body.fixedInitialUsesRemaining, request.fixedInitialUses);
            chai.assert.deepEqual(res.body.fixedInitialUses, request.fixedInitialUses);
            program = res.body;
        });

        it("can updated Program properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {
            const request: Partial<Program> = {
                fixedInitialUses: [4, 5, 6],
                valueRule: {
                    rule: "6",
                    explanation: "a hard $6"
                }
            };
            const res = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${program.id}`, "PATCH", request);
            chai.assert.equal(res.statusCode, 200);
            chai.assert.deepEqual(res.body.balanceRule, request.valueRule);
            chai.assert.deepEqual(res.body.valueRule, request.valueRule);
            chai.assert.deepEqual(res.body.fixedInitialUsesRemaining, request.fixedInitialUses);
            chai.assert.deepEqual(res.body.fixedInitialUses, request.fixedInitialUses);
            program = res.body;
        });

        it("can create a Value from Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {
            const request: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                uses: 4,
                programId: program.id,
                valueRule: {
                    rule: "2",
                    explanation: "$2"
                }
            };
            const post = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", request);
            chai.assert.equal(post.statusCode, 201, `body=${JSON.stringify(post.body)}`);
            chai.assert.equal(post.body.uses, 4);
            chai.assert.equal(post.body.usesRemaining, 4);
            chai.assert.deepEqual(post.body.valueRule, request.valueRule);
            chai.assert.deepEqual(post.body.balanceRule, request.valueRule);
        });

        let issuance: Issuance;
        it("can create an Issuance with deprecated properties `uses` and `valueRule` and overwrite program valueRule. both properties are returned.", async () => {
            const request: Partial<Issuance> = {
                id: generateId(),
                uses: 4,
                count: 1,
                name: "name",
                valueRule: {
                    rule: "100",
                    explanation: "$1"
                }
            };
            const post = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", request);
            chai.assert.equal(post.statusCode, 201, `${JSON.stringify(post.body)}`);
            chai.assert.equal(post.body.uses, 4);
            chai.assert.equal(post.body.usesRemaining, 4);
            chai.assert.deepEqual(post.body.valueRule, request.valueRule);
            chai.assert.deepEqual(post.body.balanceRule, request.valueRule);
            issuance = post.body;
        });

        it("values created from issuance inherit deprecated and new properties `uses` and `valueRule`", async () => {
            const list = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
            chai.assert.equal(list.statusCode, 200);
            chai.assert.equal(list.body.length, 1);
            chai.assert.deepEqual(list.body[0].valueRule, issuance.balanceRule);
            chai.assert.deepEqual(list.body[0].balanceRule, issuance.balanceRule);
            chai.assert.deepEqual(list.body[0].uses, 4);
            chai.assert.deepEqual(list.body[0].usesRemaining, 4);
        });
    });


    describe("check using new properties (balanceRule, fixedInitialUsesRemaining, usesRemaining) for program creation, one-off value creation, and issuance creation", () => {

        let program: Program;
        it("can create a Program with deprecated properties `fixedInitialUses` and `valueRule` and both properties are returned", async () => {
            const request: Partial<Program> = {
                id: generateId(),
                currency: "USD",
                name: "name",
                fixedInitialUsesRemaining: [1, 2, 3],
                balanceRule: {
                    rule: "500",
                    explanation: "a hard $5"
                }
            };
            const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
            chai.assert.equal(res.statusCode, 201);
            chai.assert.deepEqual(res.body.balanceRule, request.balanceRule);
            chai.assert.deepEqual(res.body.valueRule, request.balanceRule);
            chai.assert.deepEqual(res.body.fixedInitialUsesRemaining, request.fixedInitialUsesRemaining);
            chai.assert.deepEqual(res.body.fixedInitialUses, request.fixedInitialUsesRemaining);
            program = res.body;
        });

        let issuance: Issuance;
        it("can create an Issuance with new properties `usesRemaining` and `balanceRule` and both properties are returned.", async () => {
            const request: Partial<Issuance> = {
                id: generateId(),
                usesRemaining: 3,
                count: 1,
                name: "name",
                balanceRule: {
                    rule: "100",
                    explanation: "$1"
                }
            };
            const post = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", request);
            chai.assert.equal(post.statusCode, 201, `${JSON.stringify(post.body)}`);
            chai.assert.equal(post.body.uses, 3);
            chai.assert.equal(post.body.usesRemaining, 3);
            chai.assert.deepEqual(post.body.valueRule, request.balanceRule);
            chai.assert.deepEqual(post.body.balanceRule, request.balanceRule);
            issuance = post.body;
        });

        it("values created from issuance inherit deprecated and new properties `uses` and `valueRule`", async () => {
            const list = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
            chai.assert.equal(list.statusCode, 200);
            chai.assert.equal(list.body.length, 1);
            chai.assert.deepEqual(list.body[0].valueRule, issuance.balanceRule);
            chai.assert.deepEqual(list.body[0].balanceRule, issuance.balanceRule);
            chai.assert.deepEqual(list.body[0].uses, 3);
            chai.assert.deepEqual(list.body[0].usesRemaining, 3);
        });
    });
});

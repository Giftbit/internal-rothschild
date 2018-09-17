import * as testUtils from "../../utils/testUtils";
import {defaultTestUser, generateId} from "../../utils/testUtils";
import * as cassava from "cassava";
import * as chai from "chai";
import {Program} from "../../model/Program";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/programs", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "USDees",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("can list 0 programs", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/programs", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
    });

    const programRequest: Partial<Program> = {
        id: "1",
        currency: "USD",
        name: "test program"
    };
    let programResponse: Program;

    it("can create a program", async () => {
        const resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", programRequest);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.equal(resp.body.id, programRequest.id);
        chai.assert.equal(resp.body.currency, programRequest.currency);
        chai.assert.deepEqualExcluding(resp.body, {
            id: programRequest.id,
            name: programRequest.name,
            currency: programRequest.currency,
            discount: true,
            discountSellerLiability: null,
            pretax: true,
            active: true,
            redemptionRule: null,
            balanceRule: null,
            valueRule: null, // todo - remove
            minInitialBalance: null,
            maxInitialBalance: null,
            fixedInitialBalances: null,
            fixedInitialUsesRemaining: null,
            fixedInitialUses: null, // todo - remove
            startDate: null,
            endDate: null,
            metadata: null,
            createdDate: null,
            updatedDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "createdBy"]);
        chai.assert.isNotNull(resp.body.createdDate);
        chai.assert.isNotNull(resp.body.updatedDate);
        programResponse = resp.body;
    });

    it("can get the program", async () => {
        const resp = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${programResponse.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, programResponse);
    });

    it("can list programs", async () => {
        const newProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            ...programRequest,
            id: generateId(),
            name: "new program!"
        });
        chai.assert.equal(newProgram.statusCode, 201);

        const resp = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 2);
        let indexOfNewProgram = resp.body[0].id === newProgram.body.id ? 0 : 1;
        chai.assert.deepEqual(resp.body[indexOfNewProgram], newProgram.body);
        chai.assert.deepEqual(resp.body[(indexOfNewProgram + 1) % 2], programResponse);
    });

    it("can filter programs by id", async () => {
        const newProgram1 = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            ...programRequest,
            id: "one",
            name: `new program ${generateId()}`
        });
        chai.assert.equal(newProgram1.statusCode, 201);
        const newProgram2 = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            ...programRequest,
            id: "two",
            name: `new program ${generateId()}`
        });
        chai.assert.equal(newProgram2.statusCode, 201);
        const newProgram3 = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            ...programRequest,
            id: "three",
            name: `new program ${generateId()}`
        });
        chai.assert.equal(newProgram3.statusCode, 201);

        const filterResp1 = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs?id.in=${[newProgram1.body.id, newProgram2.body.id, newProgram3.body.id].join(",")}`, "GET");
        chai.assert.equal(filterResp1.statusCode, 200);
        chai.assert.equal(filterResp1.body.length, 3);

        const filterResp2 = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs?id.in=${newProgram2.body.id}`, "GET");
        chai.assert.equal(filterResp2.statusCode, 200);
        chai.assert.equal(filterResp2.body.length, 1, `filterResp.body=${JSON.stringify(filterResp2.body, null, 4)}`);
    });

    it("can filter programs by currency", async () => {
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "CAD",
            symbol: "$",
            decimalPlaces: 2
        });
        const newProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
            id: "one-cad",
            name: `new program ${generateId()}`,
            currency: "CAD"
        });
        chai.assert.equal(newProgram.statusCode, 201);

        const filterResp1 = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs?currency.eq=CAD`, "GET");
        chai.assert.equal(filterResp1.statusCode, 200);
        chai.assert.equal(filterResp1.body.length, 1);

        const respAll = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs`, "GET");
        const filterResp2 = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs?currency.eq=USD`, "GET");
        chai.assert.equal(filterResp2.statusCode, 200);
        chai.assert.equal(filterResp2.body.length, respAll.body.length - 1);
    });

    it("can filter programs by createdDate", async () => {
        const respAll = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs`, "GET");
        const filterResp1 = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs?createdDate.gte=2000-01-01T00:00:50.000Z`, "GET");
        chai.assert.equal(filterResp1.statusCode, 200);
        chai.assert.equal(filterResp1.body.length, respAll.body.length);

        const filterResp2 = await testUtils.testAuthedRequest<Program[]>(router, `/v2/programs?createdDate.gte=2121-01-01T00:00:50.000Z`, "GET");
        chai.assert.equal(filterResp2.statusCode, 200);
        chai.assert.equal(filterResp2.body.length, 0);
    });

    it("can update a program", async () => {
        const request1: Partial<Program> = {
            name: "The revised program."
        };
        const update1 = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${programRequest.id}`, "PATCH", request1);
        chai.assert.equal(update1.statusCode, 200);
        chai.assert.equal(update1.body.name, "The revised program.");
        chai.assert.isNotNull(update1.body.createdDate);
        chai.assert.isNotNull(update1.body.updatedDate);

        const request2: Partial<Program> = {
            minInitialBalance: 50,
            maxInitialBalance: 500
        };
        const update2 = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${programRequest.id}`, "PATCH", request2);
        chai.assert.equal(update2.statusCode, 200);
        chai.assert.equal(update2.body.minInitialBalance, request2.minInitialBalance);
        chai.assert.equal(update2.body.maxInitialBalance, request2.maxInitialBalance);

        const request3: Partial<Program> = {
            minInitialBalance: null,
            maxInitialBalance: null,
            balanceRule: {
                rule: "500",
                explanation: "$5 the hard way"
            }
        };
        const update3 = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${programRequest.id}`, "PATCH", request3);
        chai.assert.equal(update3.statusCode, 200);
        chai.assert.equal(update3.body.minInitialBalance, request3.minInitialBalance);
        chai.assert.equal(update3.body.maxInitialBalance, request3.maxInitialBalance);
        chai.assert.deepEqual(update3.body.balanceRule, request3.balanceRule);
    });

    it("can't update a program id", async () => {
        let request = {
            id: generateId()
        };
        const resp = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${programRequest.id}`, "PATCH", request);
        chai.assert.equal(resp.statusCode, 422);
    });

    it("can delete a program", async () => {
        const deleteResp = await testUtils.testAuthedRequest(router, `/v2/programs/${programRequest.id}`, "DELETE");
        chai.assert.equal(deleteResp.statusCode, 200);

        const getResp = await testUtils.testAuthedRequest(router, `/v2/programs/${programRequest.id}`, "GET");
        chai.assert.equal(getResp.statusCode, 404);
    });

    it("creating a program with an unknown currency 409s", async () => {
        let request: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: generateId().replace(/-/g, "").substring(0, 15)
        };
        const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 409);
    });

    it("creating a program with a duplicate id results in a 409", async () => {
        let request: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD"
        };
        let res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 201);

        res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 409);
    });

    it(`default sorting createdDate`, async () => {
        const idAndDates = [
            {id: generateId(), createdDate: new Date("3030-02-01")},
            {id: generateId(), createdDate: new Date("3030-02-02")},
            {id: generateId(), createdDate: new Date("3030-02-03")},
            {id: generateId(), createdDate: new Date("3030-02-04")}
        ];
        for (let idAndDate of idAndDates) {
            const response = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                id: idAndDate.id,
                currency: "USD",
                name: "test program"
            });
            chai.assert.equal(response.statusCode, 201);
            const knex = await getKnexWrite();
            const res: number = await knex("Programs")
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: idAndDate.id,
                })
                .update(Program.toDbProgram(testUtils.defaultTestUser.auth, {
                    ...response.body,
                    createdDate: idAndDate.createdDate,
                    updatedDate: idAndDate.createdDate
                }));
            if (res === 0) {
                chai.assert.fail(`no row updated. test is broken`);
            }
        }
        const resp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?createdDate.gt=3030-01-01", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);
        chai.assert.sameOrderedMembers(resp.body.map(tx => tx.id), idAndDates.reverse().map(tx => tx.id) /* reversed since createdDate desc */);
    });
});

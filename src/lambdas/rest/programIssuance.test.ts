import * as testUtils from "../../utils/testUtils";
import {generateId} from "../../utils/testUtils";
import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Program} from "../../model/Program";
import {Value} from "../../model/Value";
import {initializeCodeCryptographySecrets} from "../../utils/codeCryptoUtils";
import {Issuance} from "../../model/Issuance";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {Transaction} from "../../model/Transaction";
import * as sinon from "sinon";
import * as codeGenerator from "../../utils/codeGenerator";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/issuances", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

    const program: Partial<Program> = {
        id: generateId(),
        name: "program-name",
        currency: "USD"
    };

    const programWithRulesAndDates: Partial<Program> = {
        id: generateId(),
        name: "program name",
        currency: "USD",
        balanceRule: {
            rule: "500",
            explanation: "$5 the hard way"
        },
        redemptionRule: {
            rule: "1 == 1",
            explanation: "always true"
        },
        startDate: new Date("2077-01-01"),
        endDate: new Date("2078-01-01")
    };

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await initializeCodeCryptographySecrets(Promise.resolve({
            encryptionSecret: "ca7589aef4ffed15783341414fe2f4a5edf9ddad75cf2e96ed2a16aee88673ea",
            lookupHashSecret: "ae8645165cc7533dbcc84aeb21c7d6553a38271b7e3402f99d16b8a8717847e1"
        }));
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });

        const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
        chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));

        const createProgramWithRulesAndDates = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", programWithRulesAndDates);
        chai.assert.equal(createProgramWithRulesAndDates.statusCode, 201, JSON.stringify(createProgramWithRulesAndDates.body));
    });

    after(async () => {
        sinonSandbox.restore();
    });

    it(`basic issuances with varying counts. POST, GET and LIST`, async () => {
        const valuesToIssues = [1, 10, 11, 100, 1000];

        let issuances: Issuance[] = [];
        for (let count of valuesToIssues) {
            let issuance = {
                id: generateId(),
                name: "name",
                count: count,
                generateCode: {}
            };

            const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
            chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));
            chai.assert.deepEqualExcluding(createIssuance.body, {
                id: issuance.id,
                name: issuance.name,
                programId: program.id,
                count: count,
                balance: null,
                redemptionRule: null,
                balanceRule: null,
                usesRemaining: null,
                active: true,
                startDate: null,
                endDate: null,
                metadata: {},
                createdBy: testUtils.defaultTestUser.auth.teamMemberId
            }, ["createdDate", "updatedDate"]);
            issuances.push(createIssuance.body);

            const getIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances/${issuance.id}`, "GET");
            chai.assert.equal(getIssuance.statusCode, 200, `body=${JSON.stringify(getIssuance.body)}`);
            chai.assert.deepEqual(getIssuance.body, createIssuance.body);

            const listValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?limit=1000&issuanceId=${issuance.id}`, "GET");
            chai.assert.equal(listValues.statusCode, 200, `body=${JSON.stringify(listValues.body)}`);
            chai.assert.equal(listValues.body.length, issuance.count);
            chai.assert.isTrue(listValues.body[0].active);

            switch (count) {
                case 1:
                    chai.assert.deepEqual(listValues.body[0].id, issuance.id + "-0");
                    break;
                case 10:
                    chai.assert.deepEqual(listValues.body[0].id, issuance.id + "-9");
                    chai.assert.deepEqual(listValues.body[9].id, issuance.id + "-0");
                    break;
                case 11:
                    chai.assert.deepEqual(listValues.body[0].id, issuance.id + "-10");
                    chai.assert.deepEqual(listValues.body[10].id, issuance.id + "-00");
                    break;
                case 100:
                    chai.assert.deepEqual(listValues.body[0].id, issuance.id + "-99");
                    chai.assert.deepEqual(listValues.body[99].id, issuance.id + "-00");
                    break;
                case 1000:
                    chai.assert.deepEqual(listValues.body[0].id, issuance.id + "-999");
                    chai.assert.deepEqual(listValues.body[999].id, issuance.id + "-000");
                    break;
                default:
                    chai.assert.fail(null, null, `unexpected count: ${count}`);
            }

        }
        const listIssuances = await testUtils.testAuthedRequest<Issuance[]>(router, `/v2/programs/${program.id}/issuances`, "GET");
        chai.assert.equal(listIssuances.statusCode, 200, `body=${JSON.stringify(listIssuances.body)}`);
        chai.assert.equal(listIssuances.body.length, valuesToIssues.length);
        chai.assert.sameDeepMembers(listIssuances.body, issuances);
    }).timeout(10000);

    it(`issuing from program that has a balanceRule`, async () => {
        let issuance: Partial<Issuance> = {
            id: generateId(),
            name: "name",
            count: 1
        };

        const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${programWithRulesAndDates.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));
        chai.assert.deepEqual(createIssuance.body.balanceRule, programWithRulesAndDates.balanceRule, "balanceRule from program is copied over to the issuance");
        chai.assert.deepEqual(createIssuance.body.redemptionRule, programWithRulesAndDates.redemptionRule, "redemptionRule from program is copied over to the issuance");
        chai.assert.equal(createIssuance.body.startDate.toString(), programWithRulesAndDates.startDate.toISOString(), "startDate from program is copied over to the issuance");
        chai.assert.equal(createIssuance.body.endDate.toString(), programWithRulesAndDates.endDate.toISOString(), "endDate from program is copied over to the issuance");

        const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?limit=1000&issuanceId=${issuance.id}`, "GET");
        chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
        chai.assert.equal(listResponse.body.length, issuance.count);
        chai.assert.deepEqual(listResponse.body[0].balanceRule, programWithRulesAndDates.balanceRule, "balanceRule from program is copied over to the Value");
        chai.assert.deepEqual(listResponse.body[0].redemptionRule, programWithRulesAndDates.redemptionRule, "redemptionRule from program is copied over to the Value");
        chai.assert.equal(listResponse.body[0].startDate.toString(), programWithRulesAndDates.startDate.toISOString(), "startDate from program is copied over to the Value");
        chai.assert.equal(listResponse.body[0].endDate.toString(), programWithRulesAndDates.endDate.toISOString(), "endDate from program is copied over to the Value");
    });

    it(`can overwrite balanceRule, redemptionRule, startDate and endDate`, async () => {
        let issuance: Partial<Issuance> = {
            id: generateId(),
            count: 1,
            name: "name",
            balanceRule: {
                rule: "700",
                explanation: "$7 the hard way"
            },
            redemptionRule: {
                rule: "2 == 1",
                explanation: "never true"
            },
            startDate: new Date("2177-01-01"),
            endDate: new Date("2178-01-01")
        };
        chai.assert.notDeepEqual(issuance.balanceRule, programWithRulesAndDates.balanceRule);
        chai.assert.notDeepEqual(issuance.redemptionRule, programWithRulesAndDates.redemptionRule);
        chai.assert.notEqual(programWithRulesAndDates.startDate, issuance.startDate);
        chai.assert.notEqual(programWithRulesAndDates.endDate, issuance.endDate);

        const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${programWithRulesAndDates.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));
        chai.assert.deepEqual(createIssuance.body.balanceRule, issuance.balanceRule);
        chai.assert.deepEqual(createIssuance.body.redemptionRule, issuance.redemptionRule);
        chai.assert.equal(createIssuance.body.startDate.toString(), issuance.startDate.toISOString());
        chai.assert.equal(createIssuance.body.endDate.toString(), issuance.endDate.toISOString());

        const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?limit=1000&issuanceId=${issuance.id}`, "GET");
        chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
        chai.assert.equal(listResponse.body.length, issuance.count);
        chai.assert.deepEqual(listResponse.body[0].balanceRule, issuance.balanceRule);
        chai.assert.deepEqual(listResponse.body[0].redemptionRule, issuance.redemptionRule);
        chai.assert.equal(listResponse.body[0].startDate.toString(), issuance.startDate.toISOString());
        chai.assert.equal(listResponse.body[0].endDate.toString(), issuance.endDate.toISOString());
    });

    it(`issuance with generic code`, async () => {
        let issuance = {
            id: generateId(),
            name: "name",
            count: 1,
            isGenericCode: true,
            code: "PRETTY-GENERIC"
        };

        const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));

        const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?limit=1000&issuanceId=${issuance.id}`, "GET");
        chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
        chai.assert.equal(listResponse.body.length, issuance.count);
        chai.assert.equal(listResponse.body[0].code, issuance.code);
        chai.assert.isTrue(listResponse.body[0].isGenericCode);
    });

    it(`issuance with code`, async () => {
        let issuance = {
            id: generateId(),
            name: "name",
            count: 1,
            code: "IEDKQODLAOWKRJ"
        };

        const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));

        const listResponse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?limit=1000&issuanceId=${issuance.id}`, "GET");
        chai.assert.equal(listResponse.statusCode, 200, `body=${JSON.stringify(listResponse.body)}`);
        chai.assert.equal(listResponse.body.length, issuance.count);
        chai.assert.equal(listResponse.body[0].code, "…WKRJ");
        chai.assert.isFalse(listResponse.body[0].isGenericCode);
    });

    it(`422 if no name`, async () => {
        let issuance = {
            id: generateId(),
            count: 2,
            isGenericCode: true
        };

        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 422, JSON.stringify(createIssuance.body));
        chai.assert.include(createIssuance.body.message, "requestBody requires property \"name\"");
    });

    it(`422 if isGenericCode: true and count > 1`, async () => {
        let issuance = {
            id: generateId(),
            name: "name",
            count: 2,
            isGenericCode: true
        };

        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 422, JSON.stringify(createIssuance.body));
        chai.assert.include(createIssuance.body.message, "Issuance count must be 1 if isGenericCode:true.");
    });

    it(`422 if provided code and count > 1`, async () => {
        let issuance = {
            id: generateId(),
            name: "name",
            count: 2,
            code: "ABCDEFGHI"
        };

        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 422, JSON.stringify(createIssuance.body));
        chai.assert.include(createIssuance.body.message, "Issuance count must be 1 if code is set");
    });

    it(`422 if generateCode and code parameters are provided`, async () => {
        let issuance = {
            id: generateId(),
            name: "name",
            count: 1,
            code: "ABCDEFGHI",
            generateCode: {}
        };

        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 422, JSON.stringify(createIssuance.body));
        chai.assert.include(createIssuance.body.message, "Parameter generateCode is not allowed with parameters code or isGenericCode:true.");
    });

    it(`422 if program has balanceRule and try to issue with balance`, async () => {
        const program: Partial<Program> = {
            id: generateId(),
            name: "program-name",
            currency: "USD",
            balanceRule: {
                rule: "500",
                explanation: "$5 the hard way"
            }
        };
        const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
        chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));

        let issuance: Partial<Issuance> = {
            id: generateId(),
            name: "name",
            count: 1,
            balance: 1
        };

        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 422, JSON.stringify(createIssuance.body));
        chai.assert.include(createIssuance.body.message, "Value can't have both a balance and balanceRule.");
    });

    it(`404 on invalid programId`, async () => {
        let issuance: Partial<Issuance> = {
            id: generateId(),
            name: "name",
            count: 1,
            balance: 1
        };

        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${generateId()}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 404, JSON.stringify(createIssuance.body));
    });

    describe("ensure programId is considered", () => {
        const programA: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "A"
        };
        const programB: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "B"
        };
        let issuanceProgramA, issuanceProgramB;

        before(async function () {
            // setup data. 2 programs and an issuance from each.
            const createProgramA = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", programA);
            chai.assert.equal(createProgramA.statusCode, 201);
            const createProgramB = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", programB);
            chai.assert.equal(createProgramB.statusCode, 201);

            issuanceProgramA = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${programA.id}/issuances`, "POST", {
                id: generateId(),
                name: "name",
                count: 1
            });
            chai.assert.equal(issuanceProgramA.statusCode, 201);
            issuanceProgramB = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${programB.id}/issuances`, "POST", {
                id: generateId(),
                name: "name",
                count: 1
            });
            chai.assert.equal(issuanceProgramB.statusCode, 201);
        });

        it(`GET using wrong programId 404s`, async () => {
            const get = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${programA.id}/issuances/${issuanceProgramB.body.id}`, "GET");
            chai.assert.equal(get.statusCode, 404);
        });

        it(`LIST only returns issuances from provided programId`, async () => {
            const list = await testUtils.testAuthedRequest<Issuance[]>(router, `/v2/programs/${programA.id}/issuances`, "GET");
            chai.assert.equal(list.statusCode, 200);
            chai.assert.equal(list.body.length, 1);
            chai.assert.deepEqual(list.body[0], issuanceProgramA.body, `expected: ${JSON.stringify(list.body[0])} to equal ${JSON.stringify(issuanceProgramA.body)}.`);
        });
    });

    describe("max id length checks", () => {
        const program: Partial<Program> = {
            id: generateId(64),
            currency: "USD",
            name: "programo"
        };
        before(async function () {
            const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(createProgram.statusCode, 201);
            chai.assert.equal(createProgram.body.id, program.id);
            chai.assert.equal(createProgram.body.id.length, 64);
        });

        it("can create issuance with max id length", async () => {
            const issuance: Partial<Issuance> = {
                id: generateId(58), // 6 characters left for padding on values
                name: "name",
                count: 1
            };
            const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
            chai.assert.equal(createIssuance.statusCode, 201);
            chai.assert.equal(createIssuance.body.id, issuance.id);
            chai.assert.equal(createIssuance.body.id.length, 58);

            const values = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
            chai.assert.equal(values.statusCode, 200);
            chai.assert.equal(values.body.length, 1);
            chai.assert.equal(values.body[0].id, issuance.id + "-0");
        });

        it("cannot create issuance with id exceeding max length - 422s", async () => {
            const issuance: Partial<Issuance> = {
                id: generateId(59),
                name: "name",
                count: 1
            };
            const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
            chai.assert.equal(createIssuance.statusCode, 422);
            chai.assert.include(createIssuance.body.message, "requestBody.id does not meet maximum length of 58");
        });
    });

    it(`default sorting createdDate`, async () => {
        const program: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "test program"
        };

        const createValueResponse = await testUtils.testAuthedRequest<Value>(router, "/v2/programs", "POST", program);
        chai.assert.equal(createValueResponse.statusCode, 201);

        const idAndDates = [
            {id: generateId(), createdDate: new Date("3030-02-01")},
            {id: generateId(), createdDate: new Date("3030-02-02")},
            {id: generateId(), createdDate: new Date("3030-02-03")},
            {id: generateId(), createdDate: new Date("3030-02-04")}
        ];
        for (let idAndDate of idAndDates) {
            const response = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", {
                id: idAndDate.id,
                name: idAndDate.id + "-name",
                count: 1,
                balance: 1
            });
            chai.assert.equal(response.statusCode, 201, `body=${JSON.stringify(response.body)}`);
            const knex = await getKnexWrite();
            const res: number = await knex("Issuances")
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: idAndDate.id,
                })
                .update(Issuance.toDbIssuance(testUtils.defaultTestUser.auth, {
                    ...response.body,
                    createdDate: idAndDate.createdDate,
                    updatedDate: idAndDate.createdDate
                }));
            if (res === 0) {
                chai.assert.fail(`No row updated. Test data failed during setup..`);
            }
        }
        const resp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/programs/${program.id}/issuances?createdDate.gt=3030-01-01`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);
        chai.assert.sameOrderedMembers(resp.body.map(tx => tx.id), idAndDates.reverse().map(tx => tx.id) /* reversed since createdDate desc*/);
    });

    describe(`creating Issuance with metadata from Program with metadata`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with balanceRule",
            currency: "USD",
            metadata: {
                a: "A",
                b: "B"
            }
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        it("can create Issuance and Program's metadata is copied to Issuance and Values metadata", async () => {
            let issuance: Partial<Issuance> = {
                id: generateId(),
                name: "issuance name",
                count: 1
            };
            const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
            chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));
            chai.assert.isNotNull(createIssuance.body.metadata);
            chai.assert.deepEqual(createIssuance.body.metadata, program.metadata);

            const getValue = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
            chai.assert.isNotNull(getValue.body[0].metadata);
            chai.assert.deepEqual(getValue.body[0].metadata, program.metadata);
        });

        it("can create Issuance with metadata and Program's metadata is copied to Issuance and Value metadata. Issuance metadata takes precedence.", async () => {
            let issuance: Partial<Issuance> = {
                id: generateId(),
                name: "issuance name",
                count: 1,
                metadata: {
                    b: "override program",
                    c: "new"
                }
            };

            const resultingMetadata = {
                ...program.metadata,
                ...issuance.metadata
            };
            const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
            chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));
            chai.assert.deepEqual(createIssuance.body.metadata, resultingMetadata);

            const getValue = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
            chai.assert.deepEqual(getValue.body[0].metadata, resultingMetadata);
        });
    });

    it("creating Issuance with no balance results in values with balance of 0.", async () => {
        let issuance: Partial<Issuance> = {
            id: generateId(),
            name: "issuance name",
            count: 1
        };

        const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));

        const getValue = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
        chai.assert.equal(getValue.body[0].balance, 0);
    });

    it("creating Issuance with no balance results in exception if program has minInitialBalance > 0.", async () => {
        const minInitialBalanceProgram: Partial<Program> = {
            id: generateId(),
            name: "program-name",
            currency: "USD",
            minInitialBalance: 1
        };
        const createProgram = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs`, "POST", minInitialBalanceProgram);
        chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));

        let issuance: Partial<Issuance> = {
            id: generateId(),
            name: "issuance name",
            count: 1
        };
        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${minInitialBalanceProgram.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 409, JSON.stringify(createIssuance.body));
        chai.assert.equal(createIssuance.body.message, "Value's balance 0 is less than minInitialBalance 1.", JSON.stringify(createIssuance.body));
    });

    it("can create Issuance from a program that has a startDate but no endDate", async () => {
        const program: Partial<Program> = {
            id: generateId(),
            name: "program-name",
            currency: "USD",
            startDate: new Date("2019-01-01")
        };
        const createProgram = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs`, "POST", program);
        chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));

        let issuance: Partial<Issuance> = {
            id: generateId(),
            name: "issuance name",
            count: 1
        };
        const createIssuance = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
        chai.assert.equal(createIssuance.statusCode, 201, JSON.stringify(createIssuance.body));

        const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
        chai.assert.equal(getValues.statusCode, 200);
        chai.assert.equal((getValues.body[0]).startDate as any, program.startDate.toISOString());
        chai.assert.isNull(getValues.body[0].endDate);
    });

    describe("value active status scenarios", () => {
        describe("program with undefined active, defaults to active=true", () => {
            const program: Partial<Program> = {
                id: generateId(),
                name: "program-active-undefined",
                currency: "USD"
            };

            before(async () => {
                const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
                chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
                chai.assert.isTrue(createProgram.body.active); // undefined defaults to true
            });

            it("can create issuance with undefined active, defaults to program's active=true", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance"
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isTrue(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isTrue(createIssuance.body.active);
                chai.assert.isTrue(getValues.body[0].active);
            });

            it("can create issuance with active=true", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance",
                    active: true,
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isTrue(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isTrue(createIssuance.body.active);
                chai.assert.isTrue(getValues.body[0].active);
            });

            it("can create issuance with active=false", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance",
                    active: false
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isFalse(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isFalse(createIssuance.body.active);
                chai.assert.isFalse(getValues.body[0].active);
            });
        });

        describe("program with active=true", () => {
            const program: Partial<Program> = {
                id: generateId(),
                name: "program-active-true",
                currency: "USD",
                active: true
            };

            before(async () => {
                const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
                chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
                chai.assert.isTrue(createProgram.body.active);
            });

            it("can create issuance with undefined active, defaults to program's active=true", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance"
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isTrue(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isTrue(createIssuance.body.active);
                chai.assert.isTrue(getValues.body[0].active);
            });

            it("can create issuance with active=true", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance",
                    active: true,
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isTrue(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isTrue(createIssuance.body.active);
                chai.assert.isTrue(getValues.body[0].active);
            });

            it("can create issuance with active=false", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance",
                    active: false
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isFalse(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isFalse(createIssuance.body.active);
                chai.assert.isFalse(getValues.body[0].active);
            });
        });

        describe("program with active=false", () => {
            const program: Partial<Program> = {
                id: generateId(),
                name: "program-active-false",
                currency: "USD",
                active: false
            };

            before(async () => {
                const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
                chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
                chai.assert.isFalse(createProgram.body.active);
            });

            it("can create issuance with undefined active, defaults to program's active=false", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance"
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isFalse(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isFalse(createIssuance.body.active);
                chai.assert.isFalse(getValues.body[0].active);
            });

            it("can create issuance with active=true", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance",
                    active: true,
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isTrue(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isTrue(createIssuance.body.active);
                chai.assert.isTrue(getValues.body[0].active);
            });

            it("can create issuance with active=false", async () => {
                const issuance: Partial<Issuance> = {
                    id: generateId(),
                    count: 1,
                    name: "issuance",
                    active: false
                };
                const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", issuance);
                chai.assert.equal(createIssuance.statusCode, 201);
                chai.assert.isFalse(createIssuance.body.active);

                const getValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}`, "GET");
                chai.assert.equal(getValues.statusCode, 200);
                chai.assert.isFalse(createIssuance.body.active);
                chai.assert.isFalse(getValues.body[0].active);
            });
        });
    });

    it("can create issuance from small code alphabet. duplicate code errors are retried", async () => {
        const generateCodeArgs = {
            length: 6,
            charset: "abcde"
        };

        const code1 = "aaaaa";
        const code2 = "bbbbb";
        const generateCodeStub = sinonSandbox.stub(codeGenerator, "generateCode");
        generateCodeStub.withArgs(generateCodeArgs)
            .onCall(0).returns(code1)  // Value1 will be created with code1
            .onCall(1).returns(code1)  // Value2 will fail creation
            .onCall(2).returns(code1)  // Value2, retry 1 fails
            .onCall(3).returns(code2); // value2, retry 2 succeeds

        const issuance: Partial<Issuance> = {
            id: generateId(),
            count: 2,
            name: "issuance"
        };
        const createIssuance = await testUtils.testAuthedRequest<Issuance>(router, `/v2/programs/${program.id}/issuances`, "POST", {
            ...issuance,
            generateCode: generateCodeArgs
        });
        chai.assert.equal(createIssuance.statusCode, 201);
        const values = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?issuanceId=${issuance.id}&showCode=true`, "GET");
        chai.assert.equal(values.statusCode, 200);
        chai.assert.equal(generateCodeStub.callCount, 4);
        chai.assert.sameDeepMembers(values.body.map(v => v.code), [code1, code2]);
        generateCodeStub.restore()
    });
});

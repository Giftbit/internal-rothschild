import * as testUtils from "../../utils/testUtils";
import {generateId} from "../../utils/testUtils";
import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Program} from "../../model/Program";
import {Value} from "../../model/Value";
import {dateInDbPrecision} from "../../utils/dbUtils";

describe("/v2/values create from program", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("can't create a value with a programId that doesn't exist - results in 409", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            programId: generateId()
        };

        it("create Value", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });
    });

    describe(`test basic program with no balance constraints or value valueRule`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with no balance constraints or valueRule",
            currency: "USD"
        };

        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(programResp.body[prop], program[prop]);
            }
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id
        };

        it("currency must match Program", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                currency: "CAD"
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("create Value", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.currency, program.currency);
        });
    });

    describe(`test program with fixedInitialBalance constraints`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with fixedInitialBalance constraints",
            currency: "USD",
            fixedInitialBalances: [100, 200]
        };

        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id
        };

        it("create Value with no balance fails", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("create Value with balance outside of fixedIntialBalances fails", async () => {
            value.balance = 1;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("create Value with balance in fixedIntialBalances succeeds", async () => {
            value.balance = 100;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });
    });

    describe(`test program with fixedInitialUses constraints`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with fixedInitialUses constraints",
            currency: "USD",
            fixedInitialUses: [100, 200]
        };

        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id
        };

        it("create Value with no uses fails", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("create Value with uses outside of fixedIntialBalances fails", async () => {
            value.uses = 1;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("create Value with uses in fixedIntialBalances succeeds", async () => {
            value.uses = 100;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.uses, value.uses);
        });
    });

    describe(`test program with minInitialBalance and maxInitialBalance constraints`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with minInitialBalance and maxInitialBalance constraints",
            currency: "USD",
            minInitialBalance: 100,
            maxInitialBalance: 200
        };

        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id
        };

        it("create Value with null balance (outside of range) 409s", async () => {
            const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.message, "Value's balance 0 is less than minInitialBalance 100.");
        });

        it("create Value with balance below range 409s", async () => {
            value.balance = 1;
            const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.message, "Value's balance 1 is less than minInitialBalance 100.");
        });

        it("create Value with balance above range 409s", async () => {
            value.balance = 201;
            const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.message, "Value's balance 201 is greater than maxInitialBalance 200.");
        });

        it("create Value with balance in range succeeds", async () => {
            value.balance = 150;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("create Value with balance exactly on minInitialBalance succeeds", async () => {
            value.balance = program.minInitialBalance;
            value.id = generateId();
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("create Value with balance exactly on maxInitialBalance succeeds", async () => {
            value.balance = program.maxInitialBalance;
            value.id = generateId();
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });
    });

    describe(`test program with minInitialBalance=0`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with minInitialBalance and maxInitialBalance constraints",
            currency: "USD",
            minInitialBalance: 0
        };

        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id
        };

        it("create Value with balance in range succeeds", async () => {
            value.balance = 2500;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("create Value with balance exactly on minInitialBalance succeeds", async () => {
            value.balance = program.minInitialBalance;
            value.id = generateId();
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("create Value with null balance 409s", async () => {
            const valuePost_BalanceNull = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: null,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_BalanceNull.statusCode, 409);
            chai.assert.equal(valuePost_BalanceNull.body.message, "Value's balance null is less than minInitialBalance 0.");
        });
    });

    describe("creating Values from Program with minInitialBalance = null and maxInitialBalance = null", () => {
        const program: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "name",
            minInitialBalance: null,
            maxInitialBalance: null
        };

        it("create program", async () => {
            const programPost = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programPost.statusCode, 201);
        });

        describe("balance of 0 succeeds", async () => {
            const valuePost_Balance0 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: 0,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_Balance0.statusCode, 201);
        });

        describe("balance of 10 succeeds", async () => {
            const valuePost_Balance10 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: 10,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_Balance10.statusCode, 201);
        });

        describe("balance of null succeeds", async () => {
            const valuePost_BalanceNull = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: null,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_BalanceNull.statusCode, 201);
        });
    });

    describe("creating Values from Program with fixedInitialBalances = [0]", () => {
        const program: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "name",
            fixedInitialBalances: [0]
        };

        it("create program", async () => {
            const programPost = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programPost.statusCode, 201);
        });

        it("balance = 0 succeeds", async () => {
            const valuePost_Balance0 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: 0,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_Balance0.statusCode, 201);
        });

        it("balance = null 409s", async () => {
            const valuePost_BalanceNull = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: null,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_BalanceNull.statusCode, 409);
            chai.assert.equal(valuePost_BalanceNull.body.message, "Value's balance null is outside fixedInitialBalances defined by Program 0.");
        });
    });

    it("test can't create a program with minInitialBalance > maxInitialBalance", async () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with minInitialBalance and maxInitialBalance constraints",
            currency: "USD",
            minInitialBalance: 50,
            maxInitialBalance: 25
        };

        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 422, JSON.stringify(programResp.body));
        });
    });

    describe(`test program with valueRule`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with valueRule",
            currency: "USD",
            valueRule: {rule: "500", explanation: "$5 the hard way"}
        };

        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id
        };

        it("create Value with a balance fails - can't have both balance and valueRule", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                balance: 50
            });
            chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        });

        it("create Value succeeds", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.deepEqual(valueResp.body.valueRule, program.valueRule);
        });

        it("can override valueRule", async () => {
            value.id = generateId();
            value.valueRule = {rule: "600", explanation: "$6 the hard way too"};
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.deepEqual(valueResp.body.valueRule, value.valueRule);
            chai.assert.notDeepEqual(valueResp.body.valueRule, program.valueRule);
        });
    });

    describe(`test program with many properties`, () => {
        const now = new Date();
        let program = {
            id: generateId(),
            name: "program with fixedInitialBalance constraints",
            currency: "USD",
            valueRule: {rule: "500", explanation: "$5 the hard way"},
            discount: true,
            discountSellerLiability: 0.2,
            pretax: true,
            active: false,
            redemptionRule: {rule: "true", explanation: "always true"},
            fixedInitialUses: [1, 2, 3],
            startDate: new Date(new Date().setDate(now.getDate() + 10)).toJSON(),
            endDate: new Date(new Date().setDate(now.getDate() + 100)).toJSON(),
            metadata: {notes: "this is a program note"}
        };

        let startDateDbPrecision, endDateDbPrecision;
        let programProperties = Object.keys(program);
        it("create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            program.startDate = dateInDbPrecision(new Date(program.startDate)).toJSON();
            program.endDate = dateInDbPrecision(new Date(program.endDate)).toJSON();
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
            startDateDbPrecision = programResp.body.startDate;
            endDateDbPrecision = programResp.body.startDate;
        });

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id,
            uses: 3,
        };

        it("create Value succeeds", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.currency, program.currency);
            chai.assert.deepEqual(valueResp.body.valueRule, program.valueRule);
            chai.assert.equal(valueResp.body.discount, program.discount);
            chai.assert.equal(valueResp.body.discountSellerLiability, program.discountSellerLiability);
            chai.assert.equal(valueResp.body.pretax, program.pretax);
            chai.assert.equal(valueResp.body.active, program.active);
            chai.assert.deepEqual(valueResp.body.redemptionRule, program.redemptionRule);
            chai.assert.equal(valueResp.body.startDate.toString(), program.startDate);
            chai.assert.equal(valueResp.body.endDate.toString(), program.endDate);
        });

        it("can override properties", async () => {
            chai.assert.isTrue(program.discount);

            let value2 = {
                id: generateId(),
                programId: program.id,
                currency: "USD",
                valueRule: {rule: "700", explanation: "$7 the hard way"},
                pretax: !program.pretax,
                active: !program.active,
                uses: program.fixedInitialUses[0],
                redemptionRule: {rule: "false", explanation: "always false"},
                startDate: new Date(new Date().setDate(now.getDate() + 50)).toJSON(),
                endDate: new Date(new Date().setDate(now.getDate() + 150)).toJSON()
            };
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));

            // these can't differ from program. it doesn't make sense since discountSellerLiability can only be set if discount = true.
            chai.assert.equal(valueResp.body.discount, program.discount);
            chai.assert.equal(valueResp.body.discountSellerLiability, program.discountSellerLiability);
            chai.assert.equal(valueResp.body.currency, program.currency);

            chai.assert.notEqual(valueResp.body.pretax, program.pretax);
            chai.assert.notEqual(valueResp.body.active, program.active);
            chai.assert.notEqual(valueResp.body.startDate.toString(), program.startDate);
            chai.assert.notEqual(valueResp.body.endDate.toString(), program.endDate);
            chai.assert.notDeepEqual(valueResp.body.valueRule, program.valueRule);
            chai.assert.notDeepEqual(valueResp.body.redemptionRule, program.redemptionRule);

            chai.assert.equal(valueResp.body.currency, value2.currency);
            chai.assert.deepEqual(valueResp.body.valueRule, value2.valueRule);
            chai.assert.equal(valueResp.body.pretax, value2.pretax);
            chai.assert.equal(valueResp.body.active, value2.active);
            chai.assert.deepEqual(valueResp.body.redemptionRule, value2.redemptionRule);

            chai.assert.equal(valueResp.body.startDate.toString(), dateInDbPrecision(new Date(value2.startDate)).toJSON());
            chai.assert.equal(valueResp.body.endDate.toString(), dateInDbPrecision(new Date(value2.endDate)).toJSON());
        });
    });


});

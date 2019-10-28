import * as testUtils from "../../../utils/testUtils/index";
import {generateId} from "../../../utils/testUtils/index";
import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Program} from "../../../model/Program";
import {Value} from "../../../model/Value";
import {dateInDbPrecision} from "../../../utils/dbUtils/index";

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

    it("can't create a value with a programId that doesn't exist", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            programId: generateId()
        };

        const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueResp.statusCode, 404, JSON.stringify(valueResp.body));
    });

    describe(`creating Values from Program with no balance constraints or value balanceRule`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with no balance constraints or balanceRule",
            currency: "USD"
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(programResp.body[prop], program[prop]);
            }
        });

        let value: Partial<Value> = {
            programId: program.id
        };

        it("can't create Value with currency != program.currency", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId(),
                currency: "CAD"
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("can create Value", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.currency, program.currency);
        });
    });

    describe(`creating Values from Program with fixedInitialBalance constraints`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with fixedInitialBalance constraints",
            currency: "USD",
            fixedInitialBalances: [100, 200]
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            programId: program.id
        };

        it("can't create Value with balance = null", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("can't create Value with balance != fixedInitialBalances", async () => {
            value.balance = 1;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("can create Value with balance = fixedInitialBalances[0]", async () => {
            value.balance = program.fixedInitialBalances[0];
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("can create Value with balance = fixedInitialBalances[1]", async () => {
            value.balance = program.fixedInitialBalances[1];
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });
    });

    describe(`creating Values from Program with fixedInitialUses constraints`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with fixedInitialUses constraints",
            currency: "USD",
            fixedInitialUsesRemaining: [100, 200]
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            programId: program.id
        };

        it("can't create Value with usesRemaining = null", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("can't create Value with usesRemaining != fixedInitialUsesRemaining", async () => {
            value.usesRemaining = 1;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
        });

        it("can create Value with usesRemaining = fixedInitialUsesRemaining[0]", async () => {
            value.usesRemaining = program.fixedInitialUsesRemaining[0];
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.usesRemaining, value.usesRemaining);
        });

        it("can create Value with usesRemaining= fixedInitialUsesRemaining[1]", async () => {
            value.usesRemaining = program.fixedInitialUsesRemaining[1];
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.usesRemaining, value.usesRemaining);
        });
    });

    describe(`creating Values from Program with minInitialBalance and maxInitialBalance set`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with minInitialBalance and maxInitialBalance constraints",
            currency: "USD",
            minInitialBalance: 100,
            maxInitialBalance: 200
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            programId: program.id
        };

        it("can't create Value with balance = null", async () => {
            const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.message, "Value's balance 0 is less than minInitialBalance 100.");
        });

        it("can't create Value with balance < minInitialBalance", async () => {
            value.balance = 1;
            const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.message, "Value's balance 1 is less than minInitialBalance 100.");
        });

        it("can't create Value with balance > maxInitialBalance", async () => {
            value.balance = 201;
            const valueResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 409, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.message, "Value's balance 201 is greater than maxInitialBalance 200.");
        });

        it("can create Value with balance > minInitialBalance and balance < maxInitialBalance", async () => {
            value.balance = 150;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("can create Value with balance = minInitialBalance", async () => {
            value.balance = program.minInitialBalance;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("can create Value with balance = maxInitialBalance", async () => {
            value.balance = program.maxInitialBalance;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });
    });

    describe(`creating Values from Program with minInitialBalance=0`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with minInitialBalance and maxInitialBalance constraints",
            currency: "USD",
            minInitialBalance: 0
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            programId: program.id
        };

        it("can create Value with balance > minInitialBalance", async () => {
            value.balance = 2500;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("can create Value with balance = minInitialBalance", async () => {
            value.balance = program.minInitialBalance;
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.balance, value.balance);
        });

        it("can't create Value with balance = null", async () => {
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

        it("can create program", async () => {
            const programPost = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programPost.statusCode, 201);
        });

        it("can create Value with balance = 0", async () => {
            const valuePost_Balance0 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: 0,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_Balance0.statusCode, 201);
        });

        it("can create Value with balance = 10", async () => {
            const valuePost_Balance10 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: 10,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_Balance10.statusCode, 201);
        });

        it("can create Value with balance = null", async () => {
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

        it("can create program", async () => {
            const programPost = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programPost.statusCode, 201);
        });

        it("can create Value with balance = 0", async () => {
            const valuePost_Balance0 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: 0,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_Balance0.statusCode, 201);
        });

        it("can't create Value with balance = null", async () => {
            const valuePost_BalanceNull = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                id: generateId(),
                balance: null,
                programId: program.id
            } as Partial<Value>);
            chai.assert.equal(valuePost_BalanceNull.statusCode, 409);
            chai.assert.equal(valuePost_BalanceNull.body.message, "Value's balance null is outside fixedInitialBalances defined by Program 0.");
        });
    });

    it("can't create a Program with minInitialBalance > maxInitialBalance", async () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with minInitialBalance and maxInitialBalance constraints",
            currency: "USD",
            minInitialBalance: 50,
            maxInitialBalance: 25
        };

        const programResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", program);
        chai.assert.equal(programResp.statusCode, 422, JSON.stringify(programResp.body));
        chai.assert.equal(programResp.body.message, "Program's minInitialBalance cannot exceed maxInitialBalance.");
    });

    describe(`creating Values from Program with balanceRule set`, () => {
        let program: Partial<Program> = {
            id: generateId(),
            name: "program with balanceRule",
            currency: "USD",
            balanceRule: {rule: "500", explanation: "$5 the hard way"}
        };

        let programProperties = Object.keys(program);
        it("can create Program", async () => {
            const programResp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(programResp.statusCode, 201, JSON.stringify(programResp.body));
            for (let prop of programProperties) {
                chai.assert.equal(JSON.stringify(programResp.body[prop]), JSON.stringify(program[prop]));
            }
        });

        let value: Partial<Value> = {
            programId: program.id
        };

        it("can't create Value with balance != null", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId(),
                balance: 50
            });
            chai.assert.equal(valueResp.statusCode, 422, JSON.stringify(valueResp.body));
        });

        it("can create Value with balance = null", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.deepEqual(valueResp.body.balanceRule, program.balanceRule);
        });

        it("can create Value with balanceRule != null. this overrides the Program's balanceRule", async () => {
            value.balanceRule = {rule: "600", explanation: "$6 the hard way too"};
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...value,
                id: generateId()
            });
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.deepEqual(valueResp.body.balanceRule, value.balanceRule);
            chai.assert.notDeepEqual(valueResp.body.balanceRule, program.balanceRule);
        });
    });

    describe(`create Values from complex Program`, () => {
        const now = new Date();
        let program = {
            id: generateId(),
            name: "program with fixedInitialBalance constraints",
            currency: "USD",
            balanceRule: {rule: "500", explanation: "$5 the hard way"},
            discount: true,
            discountSellerLiability: 0.2,
            pretax: true,
            active: false,
            redemptionRule: {rule: "true", explanation: "always true"},
            fixedInitialUsesRemaining: [1, 2, 3],
            startDate: new Date(new Date().setDate(now.getDate() + 10)).toJSON(),
            endDate: new Date(new Date().setDate(now.getDate() + 100)).toJSON(),
            metadata: {notes: "this is a program note"}
        };

        let startDateDbPrecision, endDateDbPrecision;
        let programProperties = Object.keys(program);
        it("can create Program", async () => {
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
            usesRemaining: 3,
        };

        it("can create Value", async () => {
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.equal(valueResp.body.currency, program.currency);
            chai.assert.deepEqual(valueResp.body.balanceRule, program.balanceRule);
            chai.assert.equal(valueResp.body.discount, program.discount);
            chai.assert.equal(valueResp.body.discountSellerLiability, program.discountSellerLiability);
            chai.assert.equal(valueResp.body.pretax, program.pretax);
            chai.assert.equal(valueResp.body.active, program.active);
            chai.assert.deepEqual(valueResp.body.redemptionRule, program.redemptionRule);
            chai.assert.equal(valueResp.body.startDate.toString(), program.startDate);
            chai.assert.equal(valueResp.body.endDate.toString(), program.endDate);
        });

        it("can create Value and override Program properties", async () => {
            chai.assert.isTrue(program.discount);

            let value2 = {
                id: generateId(),
                programId: program.id,
                currency: "USD",
                balanceRule: {rule: "700", explanation: "$7 the hard way"},
                pretax: !program.pretax,
                active: !program.active,
                usesRemaining: program.fixedInitialUsesRemaining[0],
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
            chai.assert.notDeepEqual(valueResp.body.balanceRule, program.balanceRule);
            chai.assert.notDeepEqual(valueResp.body.redemptionRule, program.redemptionRule);

            chai.assert.equal(valueResp.body.currency, value2.currency);
            chai.assert.deepEqual(valueResp.body.balanceRule, value2.balanceRule);
            chai.assert.equal(valueResp.body.pretax, value2.pretax);
            chai.assert.equal(valueResp.body.active, value2.active);
            chai.assert.deepEqual(valueResp.body.redemptionRule, value2.redemptionRule);

            chai.assert.equal(valueResp.body.startDate.toString(), dateInDbPrecision(new Date(value2.startDate)).toJSON());
            chai.assert.equal(valueResp.body.endDate.toString(), dateInDbPrecision(new Date(value2.endDate)).toJSON());
        });
    });

    describe(`creating Values from Program with metadata`, () => {
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

        it("can create Value and metadata from Program is copied over", async () => {
            let value: Partial<Value> = {
                id: generateId(),
                programId: program.id
            };
            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.deepEqual(valueResp.body.metadata, program.metadata);
        });

        it("can create Value with metadata and override parts of Program's metadata", async () => {
            let value: Partial<Value> = {
                id: generateId(),
                programId: program.id,
                metadata: {
                    b: "override program",
                    c: "new"
                }
            };

            const valueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueResp.statusCode, 201, JSON.stringify(valueResp.body));
            chai.assert.deepEqual(valueResp.body.metadata, {
                ...program.metadata,
                ...value.metadata
            });
            chai.assert.notDeepEqual(valueResp.body.metadata, program.metadata);
        });
    });

    it("can create value from program that uses discountSellerLiabilityRule", async () => {
        const program: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "example",
            discount: true,
            discountSellerLiabilityRule: {
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional to marketplace rate"
            },
        };
        const createProgram = await testUtils.testAuthedRequest<Value>(router, "/v2/programs", "POST", program);
        chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
        chai.assert.deepEqual(createProgram.body.discountSellerLiabilityRule, program.discountSellerLiabilityRule);
        chai.assert.isNull(createProgram.body.discountSellerLiability);

        let value: Partial<Value> = {
            id: generateId(),
            programId: program.id,
            balance: 100
        };

        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, JSON.stringify(createValue.body));
        chai.assert.deepEqual(createValue.body.discountSellerLiabilityRule, program.discountSellerLiabilityRule);
        chai.assert.isNull(createValue.body.discountSellerLiability);
    });

    describe("program with discountSellerLiability set as number", () => {
        const program: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "example",
            discount: true,
            discountSellerLiability: 0.25
        };

        before(async () => {
            const createProgram = await testUtils.testAuthedRequest<Value>(router, "/v2/programs", "POST", program);
            chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
            chai.assert.deepEqual(createProgram.body.discountSellerLiabilityRule, {
                rule: "0.25",
                explanation: ""
            });
            chai.assert.equal(createProgram.body.discountSellerLiability, 0.25);
        });

        it("can override discountSellerLiability by setting number during value creation", async () => {
            // set discountSellerLiability as number
            let value1: Partial<Value> = {
                id: generateId(),
                programId: program.id,
                balance: 100,
                discountSellerLiability: 0.35
            };

            const createValue1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
            chai.assert.equal(createValue1.statusCode, 201, JSON.stringify(createValue1.body));
            chai.assert.deepEqual(createValue1.body.discountSellerLiabilityRule, {
                rule: "0.35", explanation: ""
            });
            chai.assert.equal(createValue1.body.discountSellerLiability, 0.35);
        });

        it("can override discountSellerLiability by setting rule during value creation", async () => {
            // set discountSellerLiability as rule
            let value2: Partial<Value> = {
                id: generateId(),
                programId: program.id,
                balance: 100,
                discountSellerLiabilityRule: {
                    rule: "1 - currentLineItem.marketplaceRate",
                    explanation: "proportional to marketplace rate"
                }
            };

            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
            chai.assert.equal(createValue.statusCode, 201, JSON.stringify(createValue.body));
            chai.assert.deepEqual(createValue.body.discountSellerLiabilityRule, value2.discountSellerLiabilityRule);
            chai.assert.isNull(createValue.body.discountSellerLiability);
        });
    });

    describe("program with discountSellerLiability set as rule", () => {
        const program: Partial<Program> = {
            id: generateId(),
            currency: "USD",
            name: "example",
            discount: true,
            discountSellerLiabilityRule: {
                rule: "1 - currentLineItem.marketplaceRate",
                explanation: "proportional to marketplace rate"
            },
        };

        before(async () => {
            const createProgram = await testUtils.testAuthedRequest<Value>(router, "/v2/programs", "POST", program);
            chai.assert.equal(createProgram.statusCode, 201, JSON.stringify(createProgram.body));
            chai.assert.deepEqual(createProgram.body.discountSellerLiabilityRule, program.discountSellerLiabilityRule);
            chai.assert.isNull(createProgram.body.discountSellerLiability);
        });

        it("can override discountSellerLiability by setting number during value creation", async () => {
            // The program has a discountSellerLiabilityRule set. It's odd to want to override to a number.
            // It's also super edge casey and not worth the additional code make possible in value creation.
            let value1: Partial<Value> = {
                id: generateId(),
                programId: program.id,
                balance: 100,
                discountSellerLiability: 0.35
            };

            const createValue1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
            chai.assert.equal(createValue1.statusCode, 201, JSON.stringify(createValue1.body));
            chai.assert.deepEqual(createValue1.body.discountSellerLiabilityRule, {
                rule: "0.35",
                explanation: ""
            });
            chai.assert.equal(createValue1.body.discountSellerLiability, 0.35);
        });

        it("can override discountSellerLiability by setting rule during value creation", async () => {
            let value2: Partial<Value> = {
                id: generateId(),
                programId: program.id,
                balance: 100,
                discountSellerLiabilityRule: {
                    rule: "currentLineItem.marketplaceRate + 0.10",
                    explanation: "some different weird rule"
                }
            };

            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
            chai.assert.equal(createValue.statusCode, 201, JSON.stringify(createValue.body));
            chai.assert.deepEqual(createValue.body.discountSellerLiabilityRule, value2.discountSellerLiabilityRule);
            chai.assert.isNull(createValue.body.discountSellerLiability);
        });
    });

});

import * as testUtils from "../../utils/testUtils";
import {defaultTestUser, generateId} from "../../utils/testUtils";
import * as cassava from "cassava";
import * as chai from "chai";
import {Program} from "../../model/Program";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {CheckoutRequest} from "../../model/TransactionRequest";
import {
    setStubsForStripeTests,
    stubCheckoutStripeCharge,
    stubStripeCapture,
    stubStripeRefund,
    unsetStubsForStripeTests
} from "../../utils/testUtils/stripeTestUtils";
import {Value} from "../../model/Value";
import {Transaction} from "../../model/Transaction";
import {ProgramStats} from "../../model/ProgramStats";
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

        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
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
            discount: false,
            discountSellerLiability: null,
            pretax: false,
            active: true,
            redemptionRule: null,
            balanceRule: null,
            minInitialBalance: null,
            maxInitialBalance: null,
            fixedInitialBalances: null,
            fixedInitialUsesRemaining: null,
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

    it("can't create a program with non-ascii characters in the ID", async () => {
        const request: Partial<Program> = {
            id: generateId() + "🐶",
            name: generateId(),
            currency: "USD"
        };
        const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 422);
    });

    it("can't create a program with minInitialBalance > maxInitialBalance", async () => {
        const request: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD",
            minInitialBalance: 10,
            maxInitialBalance: 5
        };
        const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 422);
    });

    it("can't update a program to have minInitialBalance > maxInitialBalance", async () => {
        const createRequest: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD",
            minInitialBalance: 5,
            maxInitialBalance: 10
        };
        const createRes = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", createRequest);
        chai.assert.equal(createRes.statusCode, 201);

        const patchRes = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${createRequest.id}`, "PATCH", {
            minInitialBalance: 15
        });
        chai.assert.equal(patchRes.statusCode, 422);
    });

    it("creating a program with an unknown currency 409s", async () => {
        const request: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: generateId().replace(/-/g, "").substring(0, 15)
        };
        const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 409);
    });

    it("creating a program with a duplicate id results in a 409", async () => {
        const request: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD"
        };
        const res = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res.statusCode, 201);

        const res2 = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", request);
        chai.assert.equal(res2.statusCode, 409);
    });

    it("default sorting createdDate", async () => {
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

    it("can't create a program with a balanceRule that does not compile", async () => {
        const postBody: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1",
                explanation: "unbalanced paranthesis"
            }
        };
        const progResp = await testUtils.testAuthedRequest<any>(router, "/v2/programs", "POST", postBody);
        chai.assert.equal(progResp.statusCode, 422, JSON.stringify(progResp.body));
        chai.assert.equal(progResp.body.messageCode, "BalanceRuleSyntaxError", JSON.stringify(progResp.body));
        chai.assert.isString(progResp.body.syntaxErrorMessage);
        chai.assert.isNumber(progResp.body.row);
        chai.assert.isNumber(progResp.body.column);
    });

    it("can't patch a program to have a balanceRule that does not compile", async () => {
        const postBody: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "500",
                explanation: "five hundy"
            }
        };
        const progResp = await testUtils.testAuthedRequest<any>(router, "/v2/programs", "POST", postBody);
        chai.assert.equal(progResp.statusCode, 201, JSON.stringify(progResp.body));

        const patchResp = await testUtils.testAuthedRequest<any>(router, `/v2/programs/${postBody.id}`, "PATCH", {
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1",
                explanation: "unbalanced paranthesis"
            }
        });
        chai.assert.equal(patchResp.body.messageCode, "BalanceRuleSyntaxError", JSON.stringify(patchResp.body));
        chai.assert.equal(patchResp.statusCode, 422, JSON.stringify(patchResp.body));
        chai.assert.isString(patchResp.body.syntaxErrorMessage);
        chai.assert.isNumber(patchResp.body.row);
        chai.assert.isNumber(patchResp.body.column);
    });

    it("can't create a program with a redemptionRule that does not compile", async () => {
        const postBody: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1)",
                explanation: "this is fine"
            },
            redemptionRule: {
                rule: "currentLineItem.lineTotal.subtotal > (0.1",
                explanation: "unbalanced paranthesis"
            }
        };
        const progResp = await testUtils.testAuthedRequest<any>(router, "/v2/programs", "POST", postBody);
        chai.assert.equal(progResp.statusCode, 422, JSON.stringify(progResp.body));
        chai.assert.equal(progResp.body.messageCode, "RedemptionRuleSyntaxError", JSON.stringify(progResp.body));
        chai.assert.isString(progResp.body.syntaxErrorMessage);
        chai.assert.isNumber(progResp.body.row);
        chai.assert.isNumber(progResp.body.column);
    });

    it("can't patch a program to have a redemptionRule that does not compile", async () => {
        const postBody: Partial<Program> = {
            id: generateId(),
            name: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1)",
                explanation: "this is fine"
            },
            redemptionRule: {
                rule: "1 == 1",
                explanation: "true"
            }
        };
        const progResp = await testUtils.testAuthedRequest<any>(router, "/v2/programs", "POST", postBody);
        chai.assert.equal(progResp.statusCode, 201, JSON.stringify(progResp.body));

        const patchResp = await testUtils.testAuthedRequest<any>(router, `/v2/programs/${postBody.id}`, "PATCH", {
            redemptionRule: {
                rule: "currentLineItem.lineTotal.subtotal * (0.1",
                explanation: "unbalanced paranthesis"
            }
        });
        chai.assert.equal(patchResp.body.messageCode, "RedemptionRuleSyntaxError", JSON.stringify(patchResp.body));
        chai.assert.equal(patchResp.statusCode, 422, JSON.stringify(patchResp.body));
        chai.assert.isString(patchResp.body.syntaxErrorMessage);
        chai.assert.isNumber(patchResp.body.row);
        chai.assert.isNumber(patchResp.body.column);
    });

    describe("stats", () => {
        interface Scenario {
            description: string;
            setup: (programId: string) => Promise<void>;
            result: Partial<ProgramStats>;
        }

        const scenarios: Scenario[] = [
            {
                description: "unused",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 2,
                        programId
                    });
                    chai.assert.deepEqual(value.statusCode, 201);
                },
                result: {
                    outstanding: {
                        balance: 2,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 0,
                        transactionCount: 0
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "canceled",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 100,
                        programId
                    });
                    await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.body.id}`, "PATCH", {
                        canceled: true
                    });
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 100,
                        count: 1
                    },
                    redeemed: {
                        balance: 0,
                        count: 0,
                        transactionCount: 0
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "expired",
                setup: async (programId: string) => {
                    await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 300,
                        programId,
                        endDate: new Date("2011-11-11")
                    });
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 300,
                        count: 1
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 0,
                        transactionCount: 0
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "canceled and expired",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 700,
                        programId,
                        endDate: new Date("2011-11-11")
                    });
                    await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.body.id}`, "PATCH", {
                        canceled: true
                    });
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 700,
                        count: 1
                    },
                    redeemed: {
                        balance: 0,
                        count: 0,
                        transactionCount: 0
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "credit and debit",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 10,
                        programId
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
                        id: generateId(),
                        destination: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 15,
                        currency: "USD"
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 5,
                        currency: "USD"
                    });
                },
                result: {
                    outstanding: {
                        balance: 20,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 5,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "debit then cancel",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 13,
                        programId
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 6,
                        currency: "USD"
                    });
                    await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.body.id}`, "PATCH", {
                        canceled: true
                    });
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 7,
                        count: 1
                    },
                    redeemed: {
                        balance: 6,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "debit x 3",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 20,
                        programId
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 1,
                        currency: "USD"
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 3,
                        currency: "USD"
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 5,
                        currency: "USD"
                    });
                },
                result: {
                    outstanding: {
                        balance: 11,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 9,
                        count: 1,
                        transactionCount: 3
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "debit pending capture",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 10,
                        programId
                    });
                    const debit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 4,
                        currency: "USD",
                        pending: true
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.body.id}/capture`, "POST", {
                        id: generateId()
                    });
                },
                result: {
                    outstanding: {
                        balance: 6,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 4,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "debit pending void",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 10,
                        programId
                    });
                    const debit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 4,
                        currency: "USD",
                        pending: true
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.body.id}/void`, "POST", {
                        id: generateId()
                    });
                },
                result: {
                    outstanding: {
                        balance: 10,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "debit reverse",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 10,
                        programId
                    });
                    const debit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                        id: generateId(),
                        source: {
                            rail: "lightrail",
                            valueId: value.body.id
                        },
                        amount: 4,
                        currency: "USD"
                    });
                    await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${debit.body.id}/reverse`, "POST", {
                        id: generateId()
                    });
                },
                result: {
                    outstanding: {
                        balance: 10,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "checkout lightrail",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "dead-parrot",
                                quantity: 1,
                                unitPrice: 1
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value.body.id
                            }
                        ]
                    });
                },
                result: {
                    outstanding: {
                        balance: 3,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 1,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 1,
                        overspend: 0,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout lightrail balanceRule",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balanceRule: {
                            explanation: "100% off",
                            rule: "currentLineItem.lineTotal.remainder"
                        },
                        programId
                    });
                    chai.assert.deepEqual(value.statusCode, 201, JSON.stringify(value.body));
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "log",
                                quantity: 1,
                                unitPrice: 3
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value.body.id
                            }
                        ]
                    });
                    chai.assert.deepEqual(checkout.statusCode, 201, JSON.stringify(checkout.body));
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 3,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 3,
                        overspend: 0,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout lightrail + internal",
                setup: async (programId: string) => {
                    const value1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 20,
                        programId
                    });
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "duff-beer",
                                quantity: 1,
                                unitPrice: 10
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value1.body.id
                            },
                            {
                                rail: "internal",
                                internalId: generateId(),
                                balance: 4,
                                beforeLightrail: true
                            }
                        ]
                    });
                },
                result: {
                    outstanding: {
                        balance: 14,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 6,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 6,
                        overspend: 4,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout lightrail + remainder",
                setup: async (programId: string) => {
                    const value1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "everlasting-gobstopper",
                                quantity: 1,
                                unitPrice: 15
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value1.body.id
                            }
                        ],
                        allowRemainder: true
                    });
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 4,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 4,
                        overspend: 11,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout stripe",
                setup: async (programId: string) => {
                    const checkoutRequest: CheckoutRequest = {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "bachelor-chow",
                                quantity: 1,
                                unitPrice: 6
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "stripe",
                                source: "tok_visa"
                            }
                        ]
                    };
                    stubCheckoutStripeCharge(checkoutRequest, 0, 6);
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 0,
                        transactionCount: 0
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            },
            {
                description: "checkout 2x lightrail + stripe",
                setup: async (programId: string) => {
                    const value1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const value2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const checkoutRequest: CheckoutRequest = {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "squishee",
                                quantity: 1,
                                unitPrice: 14
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value1.body.id
                            },
                            {
                                rail: "lightrail",
                                valueId: value2.body.id
                            },
                            {
                                rail: "stripe",
                                source: "tok_visa"
                            }
                        ]
                    };
                    stubCheckoutStripeCharge(checkoutRequest, 2, 6);
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 8,
                        count: 2,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 8,
                        overspend: 6,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout pending capture",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const checkoutRequest: CheckoutRequest = {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "plumbus",
                                quantity: 1,
                                unitPrice: 14
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value.body.id
                            },
                            {
                                rail: "stripe",
                                source: "tok_visa"
                            }
                        ],
                        pending: true
                    };
                    const [charge] = stubCheckoutStripeCharge(checkoutRequest, 1, 10);
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                    stubStripeCapture(charge);
                    await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.body.id}/capture`, "POST", {id: generateId()});
                },
                result: {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 4,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 4,
                        overspend: 10,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout pending void",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const checkoutRequest: CheckoutRequest = {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "plumbus",
                                quantity: 1,
                                unitPrice: 14
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value.body.id
                            },
                            {
                                rail: "stripe",
                                source: "tok_visa"
                            }
                        ],
                        pending: true
                    };
                    const [charge] = stubCheckoutStripeCharge(checkoutRequest, 1, 10);
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                    stubStripeRefund(charge);
                    await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.body.id}/void`, "POST", {id: generateId()});
                },
                result: {
                    outstanding: {
                        balance: 4,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 1
                    }
                }
            },
            {
                description: "checkout reverse",
                setup: async (programId: string) => {
                    const value = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                        id: generateId(),
                        balance: 4,
                        programId
                    });
                    const checkoutRequest: CheckoutRequest = {
                        id: generateId(),
                        lineItems: [
                            {
                                type: "product",
                                productId: "plumbus",
                                quantity: 1,
                                unitPrice: 14
                            }
                        ],
                        currency: "USD",
                        sources: [
                            {
                                rail: "lightrail",
                                valueId: value.body.id
                            },
                            {
                                rail: "stripe",
                                source: "tok_visa"
                            }
                        ]
                    };
                    const [charge] = stubCheckoutStripeCharge(checkoutRequest, 1, 10);
                    const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                    stubStripeRefund(charge);
                    await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.body.id}/reverse`, "POST", {id: generateId()});
                },
                result: {
                    outstanding: {
                        balance: 4,
                        count: 1
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 1,
                        transactionCount: 1
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 1
                    }
                }
            },
        ];

        function buildScenarioTest(scenario: Scenario): void {
            it(scenario.description, async () => {
                const programId = generateId();
                const progResp = await testUtils.testAuthedRequest<any>(router, "/v2/programs", "POST", {
                    id: programId,
                    name: generateId(),
                    currency: "USD"
                });
                chai.assert.equal(progResp.statusCode, 201, JSON.stringify(progResp.body));

                await scenario.setup(programId);

                const statsResp = await testUtils.testAuthedRequest<any>(router, `/v2/programs/${programId}/stats`, "GET");
                chai.assert.equal(statsResp.statusCode, 200, JSON.stringify(statsResp.body));
                chai.assert.deepEqual(statsResp.body, scenario.result);
            });
        }

        // Run each scenario individually.
        scenarios.forEach(buildScenarioTest);

        // Run all the scenarios together for one result.
        buildScenarioTest({
            description: "all together",
            setup: async (programId: string) => {
                for (const scenario of scenarios) {
                    await scenario.setup(programId);
                }
            },
            result: scenarios.reduce(
                (result, scenario) => {
                    const r: any = {};
                    for (const key1 in scenario.result) {
                        r[key1] = {};
                        for (const key2 in scenario.result[key1]) {
                            r[key1][key2] = result[key1][key2] + scenario.result[key1][key2];
                        }
                    }
                    return r;
                },
                {
                    outstanding: {
                        balance: 0,
                        count: 0
                    },
                    expired: {
                        balance: 0,
                        count: 0
                    },
                    canceled: {
                        balance: 0,
                        count: 0
                    },
                    redeemed: {
                        balance: 0,
                        count: 0,
                        transactionCount: 0
                    },
                    checkout: {
                        lightrailSpend: 0,
                        overspend: 0,
                        transactionCount: 0
                    }
                }
            )
        });
    });


    it("can create program with maximum id length", async () => {
        const program: Partial<Program> = {
            id: generateId(64),
            currency: "USD",
            name: "name"
        };
        chai.assert.equal(program.id.length, 64);

        const createProgram = await testUtils.testAuthedRequest<Program>(router, `/v2/programs`, "POST", program);
        chai.assert.equal(createProgram.statusCode, 201);
        chai.assert.equal(createProgram.body.id, program.id);
    });

    it("cannot create program with id exceeding max length of 64 - returns 422", async () => {
        const program: Partial<Program> = {
            id: generateId(65),
            currency: "USD",
            name: "name"
        };
        chai.assert.equal(program.id.length, 65);

        const createProgram = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/programs`, "POST", program);
        chai.assert.equal(createProgram.statusCode, 422);
        chai.assert.include(createProgram.body.message, "requestBody.id does not meet maximum length of 64");
    });
});

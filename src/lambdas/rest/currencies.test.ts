import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateId} from "../../utils/testUtils";
import {Currency, formatObjectsAmountPropertiesForCurrencyDisplay} from "../../model/Currency";
import {Value} from "../../model/Value";
import {installRestRoutes} from "./installRestRoutes";
import {DebitRequest} from "../../model/TransactionRequest";
import chaiExclude from "chai-exclude";
import {Transaction} from "../../model/Transaction";
import {Program} from "../../model/Program";

chai.use(chaiExclude);

describe("/v2/currencies", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
    });

    it("can list 0 currencies", async () => {
        const resp = await testUtils.testAuthedRequest<Currency[]>(router, "/v2/currencies", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
    });

    const funbux: Partial<Currency> = {
        code: "FUNBUX",
        name: "Fun bux",
        symbol: "⭐",
        decimalPlaces: 0
    };

    it("can create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", funbux);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, funbux, ["createdDate", "updatedDate", "createdBy"]);
        chai.assert.isString(resp.body.createdDate);
        chai.assert.isString(resp.body.updatedDate);
        chai.assert.equal(resp.body.createdBy, testUtils.defaultTestUser.teamMemberId);
    });

    it("can get the currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, funbux, ["createdDate", "updatedDate", "createdBy"]);
        chai.assert.isString(resp.body.createdDate);
        chai.assert.isString(resp.body.updatedDate);
        chai.assert.equal(resp.body.createdBy, testUtils.defaultTestUser.teamMemberId);
    });

    it("can list 1 currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency[]>(router, "/v2/currencies", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [funbux], ["createdDate", "updatedDate", "createdBy"]);
        chai.assert.isString(resp.body[0].createdDate);
        chai.assert.isString(resp.body[0].updatedDate);
        chai.assert.equal(resp.body[0].createdBy, testUtils.defaultTestUser.teamMemberId);
    });

    it("can list 1 currency in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Currency>(router, "/v2/currencies", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [funbux], ["createdDate", "updatedDate", "createdBy"]);
        chai.assert.equal(resp.body[0].createdBy, testUtils.defaultTestUser.teamMemberId);
    });

    it("can't create a currency with lower-case characters in the code", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "Euro",
            name: "Euro",
            symbol: "€",
            decimalPlaces: 2
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("can't create a currency with non-ascii characters in the code", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "🐱",
            name: "Kitties",
            symbol: "K",
            decimalPlaces: 0
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a code to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            code: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a name to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            name: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a symbol to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            symbol: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires decimalPlaces to create a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            ...funbux,
            decimalPlaces: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("404s on getting invalid currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/iamnotavalidcurrency`, "GET");
        chai.assert.equal(resp.statusCode, 404);
    });

    it("can modify a currency", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "PATCH", {
            name: funbux.name = "Funner buxes"
        });
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcluding(resp.body, funbux, ["createdDate", "updatedDate", "createdBy"]);

        const resp2 = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "GET");
        chai.assert.equal(resp2.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp2.body, funbux, ["createdDate", "updatedDate", "createdBy"]);
    });

    it("can delete an unused currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/currencies/${funbux.code}`, "DELETE");
        chai.assert.equal(resp.statusCode, 200);

        const resp2 = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${funbux.code}`, "GET");
        chai.assert.equal(resp2.statusCode, 404);
    });

    it("409s on deleting a currency in use", async () => {
        const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", funbux);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);

        const value1: Partial<Value> = {
            id: "1",
            currency: funbux.code,
            balance: 5000
        };

        const resp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(resp2.statusCode, 201, `body=${JSON.stringify(resp2.body)}`);

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/currencies/${funbux.code}`, "DELETE");
        chai.assert.equal(resp3.statusCode, 409);
        chai.assert.equal(resp3.body.messageCode, "CurrencyInUse");
    });

    describe("handling unicode in IDs", () => {
        it("404s getting a Currency by code with unicode", async () => {
            const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/currencies/%F0%9F%92%A9", "GET");
            chai.assert.equal(valueResp.statusCode, 404);
            chai.assert.equal(valueResp.body.messageCode, "CurrencyNotFound");
        });

        it("404s patching a Currency by code with unicode", async () => {
            const patchResp = await testUtils.testAuthedRequest<any>(router, "/v2/currencies/%F0%9F%92%A9", "PATCH", {pretax: true});
            chai.assert.equal(patchResp.statusCode, 404);
            chai.assert.equal(patchResp.body.messageCode, "CurrencyNotFound");
        });

        it("404s deleting a Currency by code with unicode", async () => {
            const deleteResp = await testUtils.testAuthedRequest<any>(router, "/v2/currencies/%F0%9F%92%A9", "DELETE");
            chai.assert.equal(deleteResp.statusCode, 404);
            chai.assert.equal(deleteResp.body.messageCode, "CurrencyNotFound", deleteResp.bodyRaw);
        });
    });

    describe("test common requests involving currency", () => {
        const currencies: Partial<Currency>[] = [
            {
                code: "NPR",
                name: "Nepalese Rupee",
                symbol: "npr",
                decimalPlaces: 0
            },
            {
                code: "A",
                name: "A-Currency",
                symbol: "ã",
                decimalPlaces: 1
            },
            {
                code: "AB",
                name: "Two code currency",
                symbol: "AB",
                decimalPlaces: 2
            },
            {
                code: "ABC",
                name: "Three code currency",
                symbol: "ABC",
                decimalPlaces: 2
            },
            {
                code: "BHD",
                name: "Bahraini dinar",
                symbol: "BD",
                decimalPlaces: 3
            }
        ];

        for (const currency of currencies) {
            it(`can create currency ${currency.code}`, async () => {
                const resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", currency);
                chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);
                chai.assert.deepEqualExcluding(resp.body, currency, ["createdDate", "updatedDate", "createdBy"]);
            });

            let valueId: string;
            it("can create value in currency", async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    balance: 1
                };

                const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
                chai.assert.equal(postValue.statusCode, 201);
                chai.assert.equal(postValue.body.currency, currency.code);
                valueId = postValue.body.id;
            });

            it("can create a debit against value in currency", async () => {
                const debit: Partial<DebitRequest> = {
                    id: generateId(),
                    currency: currency.code,
                    amount: 1,
                    source: {
                        rail: "lightrail",
                        valueId: valueId
                    }
                };
                const postTransaction = await testUtils.testAuthedRequest<Value>(router, `/v2/transactions/debit`, "POST", debit);
                chai.assert.equal(postTransaction.statusCode, 201);
                chai.assert.equal(postTransaction.body.currency, currency.code);
            });
        }
    });

    it("currency formatting", async () => {
        const zero = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "ZERO",
            name: "Zero Decimals",
            symbol: "zero",
            decimalPlaces: 0
        });
        chai.assert.equal(zero.statusCode, 201, `body=${JSON.stringify(zero.body)}`);

        const oneDecimalCurrency = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "ONE",
            name: "One Decimal",
            symbol: "one",
            decimalPlaces: 1
        });
        chai.assert.equal(oneDecimalCurrency.statusCode, 201, `body=${JSON.stringify(oneDecimalCurrency.body)}`);

        const twoDecimalCurrency = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "TWO",
            name: "Two Decimals",
            symbol: "two",
            decimalPlaces: 2
        });
        chai.assert.equal(twoDecimalCurrency.statusCode, 201, `body=${JSON.stringify(twoDecimalCurrency.body)}`);

        const res = await formatObjectsAmountPropertiesForCurrencyDisplay(testUtils.defaultTestUser.auth, [{
            currency: "ONE",
            level: 1,
            nested: {
                level: 2,
                nested: {
                    level: 3
                }
            }
        }, {
            currency: "TWO",
            level: 1,
            nested: {
                level: 2
            }
        }, {
            currency: "ZERO",
            level: 1
        }
        ], ["level", "nested.level", "nested.nested.level"]);
        chai.assert.deepEqual(res, [
            {
                "currency": "ONE",
                "level": "one0.1",
                "nested": {
                    "level": "one0.2",
                    "nested": {
                        "level": "one0.3"
                    }
                }
            },
            {
                "currency": "TWO",
                "level": "two0.01",
                "nested": {
                    "level": "two0.02"
                }
            },
            {
                "currency": "ZERO",
                "level": "zero1"
            }
        ]);
    });

    describe("whitespace handling", () => {
        const currWithLeading: Partial<Currency> = {
            name: "Whitespace test currency",
            symbol: "$",
            decimalPlaces: 2,
            code: " abc"
        };
        const currWithTrailing: Partial<Currency> = {
            name: "Whitespace test currency",
            symbol: "$",
            decimalPlaces: 2,
            code: "abc "
        };

        it("422s creating currency codes with leading/trailing whitespace", async () => {
            const resp1 = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/currencies", "POST", currWithLeading);
            chai.assert.equal(resp1.statusCode, 422, JSON.stringify(resp1.body));

            const resp2 = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/currencies", "POST", currWithTrailing);
            chai.assert.equal(resp2.statusCode, 422, JSON.stringify(resp2.body));
        });

        it("404s fetching a currency by code with leading/trailing whitespace", async () => {
            const createCurrencyResp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
                ...currWithTrailing,
                code: "NEW"
            });
            chai.assert.equal(createCurrencyResp.statusCode, 201, `createCurrencyResp.body=${JSON.stringify(createCurrencyResp.body)}`);

            const fetchLeading = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/currencies/%20${createCurrencyResp.body.code}`, "GET");
            chai.assert.equal(fetchLeading.statusCode, 404, `fetchLeading.body=${JSON.stringify(fetchLeading.body)}`);
            const fetchTrailing = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/currencies/${createCurrencyResp.body.code}%20`, "GET");
            chai.assert.equal(fetchTrailing.statusCode, 404, `fetchTrailing.body=${JSON.stringify(fetchTrailing.body)}`);
        });

        describe("FK references to currency codes", () => {
            before(async () => {
                await testUtils.createUSD(router);
            });

            it("409s creating transactions that use currency codes with leading/trailing whitespace", async () => {
                const value = await testUtils.createUSDValue(router);

                const txLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/credit", "POST", {
                    id: testUtils.generateId(),
                    currency: " USD",
                    amount: 1,
                    destination: {
                        rail: "lightrail",
                        valueId: value.id
                    }
                });
                chai.assert.equal(txLeadingResp.statusCode, 409, `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);
                chai.assert.equal(txLeadingResp.body["messageCode"], "WrongCurrency", `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);

                const txTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/credit", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    amount: 1,
                    destination: {
                        rail: "lightrail",
                        valueId: value.id
                    }
                });
                chai.assert.equal(txTrailingResp.statusCode, 409, `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
                chai.assert.equal(txTrailingResp.body["messageCode"], "WrongCurrency", `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
            });

            it("409s creating programs that use currency codes with leading/trailing whitespace", async () => {
                const programLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Leading whitespace test",
                    currency: " USD"
                });
                chai.assert.equal(programLeadingResp.statusCode, 409, `programLeadingResp.body=${JSON.stringify(programLeadingResp.body)}`);
                chai.assert.equal(programLeadingResp.body["messageCode"], "CurrencyNotFound", `programLeadingResp.body=${JSON.stringify(programLeadingResp.body)}`);
                const programTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "Trailing whitespace test",
                    currency: "USD "
                });
                chai.assert.equal(programTrailingResp.statusCode, 409, `programTrailingResp.body=${JSON.stringify(programTrailingResp.body)}`);
                chai.assert.equal(programTrailingResp.body["messageCode"], "CurrencyNotFound", `programTrailingResp.body=${JSON.stringify(programTrailingResp.body)}`);
            });

            it("409s creating values that use currency codes with leading/trailing whitespace", async () => {
                const valueLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: " USD",
                    balance: 50
                });
                chai.assert.equal(valueLeadingResp.statusCode, 409, `valueLeadingResp.body=${JSON.stringify(valueLeadingResp.body)}`);
                chai.assert.equal(valueLeadingResp.body["messageCode"], "CurrencyNotFound", `valueLeadingResp.body=${JSON.stringify(valueLeadingResp.body)}`);
                const valueTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD ",
                    balance: 50
                });
                chai.assert.equal(valueTrailingResp.statusCode, 409, `valueTrailingResp.body=${JSON.stringify(valueTrailingResp.body)}`);
                chai.assert.equal(valueTrailingResp.body["messageCode"], "CurrencyNotFound", `valueTrailingResp.body=${JSON.stringify(valueTrailingResp.body)}`);
            });

            it("does not find transactions when searching by currency code with leading/trailing whitespace", async () => {
                await testUtils.createUSDCheckout(router, {}, false);
                const fetchTxResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=USD", "GET");
                chai.assert.equal(fetchTxResp.statusCode, 200, `fetchTxResp.body=${JSON.stringify(fetchTxResp.body)}`);
                chai.assert.isAtLeast(fetchTxResp.body.length, 1);

                const fetchTxLeadingResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=%20USD", "GET");
                chai.assert.equal(fetchTxLeadingResp.statusCode, 200, `fetchTxLeadingResp.body=${JSON.stringify(fetchTxLeadingResp.body)}`);
                chai.assert.equal(fetchTxLeadingResp.body.length, 0, `fetchTxLeadingResp.body=${JSON.stringify(fetchTxLeadingResp.body)}`);
                const fetchTxTrailingResp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?currency=USD%20", "GET");
                chai.assert.equal(fetchTxTrailingResp.statusCode, 200, `fetchTxTrailingResp.body=${JSON.stringify(fetchTxTrailingResp.body)}`);
                chai.assert.equal(fetchTxTrailingResp.body.length, 0, `fetchTxTrailingResp.body=${JSON.stringify(fetchTxTrailingResp.body)}`);
            });

            it("does not find programs when searching by currency code with leading/trailing whitespace", async () => {
                await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                    id: testUtils.generateId(),
                    name: "example",
                    currency: "USD"
                });
                const fetchProgramResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=USD", "GET");
                chai.assert.equal(fetchProgramResp.statusCode, 200, `fetchProgramResp.body=${JSON.stringify(fetchProgramResp.body)}`);
                chai.assert.isAtLeast(fetchProgramResp.body.length, 1);

                const fetchProgramsLeadingResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=%20USD", "GET");
                chai.assert.equal(fetchProgramsLeadingResp.statusCode, 200, `fetchProgramsLeadingResp.body=${JSON.stringify(fetchProgramsLeadingResp.body)}`);
                chai.assert.equal(fetchProgramsLeadingResp.body.length, 0, `fetchProgramsLeadingResp.body=${JSON.stringify(fetchProgramsLeadingResp.body)}`);
                const fetchProgramsTrailingResp = await testUtils.testAuthedRequest<Program[]>(router, "/v2/programs?currency=USD%20", "GET");
                chai.assert.equal(fetchProgramsTrailingResp.statusCode, 200, `fetchProgramsTrailingResp.body=${JSON.stringify(fetchProgramsTrailingResp.body)}`);
                chai.assert.equal(fetchProgramsTrailingResp.body.length, 0, `fetchProgramsTrailingResp.body=${JSON.stringify(fetchProgramsTrailingResp.body)}`);
            });

            it("does not find values when searching by currency code with leading/trailing whitespace", async () => {
                await testUtils.createUSDValue(router);
                const fetchValuesResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?currency=USD", "GET");
                chai.assert.equal(fetchValuesResp.statusCode, 200, `fetchValuesResp.body=${JSON.stringify(fetchValuesResp.body)}`);
                chai.assert.isAtLeast(fetchValuesResp.body.length, 1);

                const fetchValuesLeadingResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?currency=%20USD", "GET");
                chai.assert.equal(fetchValuesLeadingResp.statusCode, 200, `fetchValuesLeadingResp.body=${JSON.stringify(fetchValuesLeadingResp.body)}`);
                chai.assert.equal(fetchValuesLeadingResp.body.length, 0, `fetchValuesLeadingResp.body=${JSON.stringify(fetchValuesLeadingResp.body)}`);
                const fetchValuesTrailingResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/values?currency=USD%20", "GET");
                chai.assert.equal(fetchValuesTrailingResp.statusCode, 200, `fetchValuesTrailingResp.body=${JSON.stringify(fetchValuesTrailingResp.body)}`);
                chai.assert.equal(fetchValuesTrailingResp.body.length, 0, `fetchValuesTrailingResp.body=${JSON.stringify(fetchValuesTrailingResp.body)}`);
            });
        });
    });
});

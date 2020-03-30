import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateId} from "../../utils/testUtils";
import {Currency, formatObjectsAmountPropertiesForCurrencyDisplay} from "../../model/Currency";
import {Value} from "../../model/Value";
import {installRestRoutes} from "./installRestRoutes";
import {DebitRequest} from "../../model/TransactionRequest";
import chaiExclude from "chai-exclude";

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
            const valueResp = await testUtils.testAuthedRequest<any>(router, "/v2/currencies/%22%3E%3Cimg%20src%3D1%20onerror%3Dprompt(document.cookie)%3B%3E%F0%9F%98%82", "GET");
            chai.assert.equal(valueResp.statusCode, 404);
            chai.assert.equal(valueResp.body.messageCode, "CurrencyNotFound");
        });

        it("404s patching a Currency by code with unicode", async () => {
            const patchResp = await testUtils.testAuthedRequest<any>(router, "/v2/currencies/%22%3E%3Cimg%20src%3D1%20onerror%3Dprompt(document.cookie)%3B%3E%F0%9F%98%82", "PATCH", {pretax: true});
            chai.assert.equal(patchResp.statusCode, 404);
            chai.assert.equal(patchResp.body.messageCode, "CurrencyNotFound");
        });

        it("404s deleting a Currency by code with unicode", async () => {
            const deleteResp = await testUtils.testAuthedRequest<any>(router, "/v2/currencies/%22%3E%3Cimg%20src%3D1%20onerror%3Dprompt(document.cookie)%3B%3E%F0%9F%98%82", "DELETE");
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
});

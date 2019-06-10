import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils/index";
import {defaultTestUser, generateId} from "../../../utils/testUtils/index";
import {Value} from "../../../model/Value";
import * as currencies from "../currencies";
import * as cassava from "cassava";
import {installRestRoutes} from "../installRestRoutes";


describe("values currency display tests", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
    });

    it("can format for currency with 0 decimal places", async () => {
        const currency = await currencies.createCurrency(defaultTestUser.auth, {
            code: "JPY",
            name: "Japanese Yen",
            symbol: "¥",
            decimalPlaces: 0
        });

        const valueBalance0: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 0
        };
        const valueBalance40: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 40
        };
        const valueBalance549: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 549
        };
        const valueBalance1549: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 1549
        };
        const valueBalance15490: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 15490
        };
        const valueBalanceRule: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balanceRule: {
                rule: "1",
                explanation: "1"
            }
        };

        const values: Partial<Value>[] = [valueBalance0, valueBalance40, valueBalance549, valueBalance1549, valueBalance15490, valueBalanceRule];
        for (let value of values) {
            const res = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(res.statusCode, 201);
        }

        const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?id.in=${values.map(v => v.id).join(",")}&formatCurrencies=true`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.lengthOf(resp.body, 6);
        chai.assert.equal(resp.body.find(v => v.id === valueBalance0.id).balance.toString(), "¥0");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance40.id).balance.toString(), "¥40");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance549.id).balance.toString(), "¥549");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance1549.id).balance.toString(), "¥1549");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance15490.id).balance.toString(), "¥15490");
        chai.assert.isNull(resp.body.find(v => v.id === valueBalanceRule.id).balance);
    });

    it("can format for currency with 0 decimal places", async () => {
        const currency = await currencies.createCurrency(defaultTestUser.auth, {
            code: "IDK",
            name: "I Don't Know",
            symbol: "I",
            decimalPlaces: 1
        });

        const valueBalance0: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 0
        };
        const valueBalance40: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 40
        };
        const valueBalance549: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 549
        };
        const valueBalance1549: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 1549
        };
        const valueBalance15490: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 15490
        };

        const values: Partial<Value>[] = [valueBalance0, valueBalance40, valueBalance549, valueBalance1549, valueBalance15490];
        for (let value of values) {
            const res = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(res.statusCode, 201);
        }

        const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?id.in=${values.map(v => v.id).join(",")}&formatCurrencies=true`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.lengthOf(resp.body, 5);
        chai.assert.equal(resp.body.find(v => v.id === valueBalance0.id).balance.toString(), "I0.0");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance40.id).balance.toString(), "I4.0");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance549.id).balance.toString(), "I54.9");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance1549.id).balance.toString(), "I154.9");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance15490.id).balance.toString(), "I1549.0");
    });

    it("can format for currency with 2 decimal places", async () => {
        const currency = await currencies.createCurrency(defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });

        const valueBalance0: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 0
        };
        const valueBalance40: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 40
        };
        const valueBalance549: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 549
        };
        const valueBalance1549: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 1549
        };
        const valueBalance15490: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 15490
        };

        const values: Partial<Value>[] = [valueBalance0, valueBalance40, valueBalance549, valueBalance1549, valueBalance15490];
        for (let value of values) {
            const res = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(res.statusCode, 201);
        }

        const resp = await testUtils.testAuthedCsvRequest<Value>(router, `/v2/values?id.in=${values.map(v => v.id).join(",")}&formatCurrencies=true`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.lengthOf(resp.body, 5);
        chai.assert.equal(resp.body.find(v => v.id === valueBalance0.id).balance.toString(), "$0.00");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance40.id).balance.toString(), "$0.40");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance549.id).balance.toString(), "$5.49");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance1549.id).balance.toString(), "$15.49");
        chai.assert.equal(resp.body.find(v => v.id === valueBalance15490.id).balance.toString(), "$154.90");
    });

    it("can format nested property genericCodeOptions.perContact.balance", async () => {
        const currency = await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Dollars",
            symbol: "$",
            decimalPlaces: 2
        });

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: 500,
                    usesRemaining: null
                }
            },
            balance: 1000
        };
        const createGenericCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(createGenericCode.statusCode, 201);
        chai.assert.deepNestedInclude(createGenericCode.body, genericValue);

        const list = await testUtils.testAuthedRequest<any[]>(router, `/v2/values?id=${genericValue.id}&formatCurrencies=true`, "GET");
        chai.assert.deepNestedInclude(list.body[0], {
            balance: "$10.00",
            genericCodeOptions: {
                perContact: {
                    balance: "$5.00",
                    usesRemaining: null
                }
            }
        })
    });
});


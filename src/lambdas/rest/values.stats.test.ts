import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {setCodeCryptographySecrets} from "../../utils/testUtils";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {Transaction} from "../../model/Transaction";

describe.only("/v2/values/ - stats", () => {

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

    describe("getting a single Value", () => {
        it("gets initialBalance > 0 when the Value was created with a balance > 0", async () => {
            const value: Partial<Value> = {
                id: "1",
                currency: "USD",
                balance: 1000
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: "debit-1",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 599,
                currency: "USD"
            });
            chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);

            const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal(getValueResp.body.id, value.id);
            chai.assert.equal(getValueResp.body.balance, 401);
            chai.assert.isObject((getValueResp.body as any).stats, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal((getValueResp.body as any).stats.initialBalance, 1000);
        });

        it("gets initialBalance = 0 when the Value was created with a balance = 0", async () => {
            const value: Partial<Value> = {
                id: "2",
                currency: "USD"
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
                id: "credit-1",
                destination: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 12345,
                currency: "USD"
            });
            chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);

            const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal(getValueResp.body.id, value.id);
            chai.assert.equal(getValueResp.body.balance, 12345);
            chai.assert.isObject((getValueResp.body as any).stats, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal((getValueResp.body as any).stats.initialBalance, 0);
        });
    });

    describe("getting multiple Values", () => {
        it("gets the initialBalance stats laid out above", async () => {
            const getValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?stats=true`, "GET");
            chai.assert.equal(getValuesResp.statusCode, 200, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.lengthOf(getValuesResp.body, 2);

            const value1 = getValuesResp.body.find(v => v.id === "1");
            chai.assert.equal(value1.balance, 401);
            chai.assert.isObject((value1 as any).stats, `value1=${value1}`);
            chai.assert.equal((value1 as any).stats.initialBalance, 1000);

            const value2 = getValuesResp.body.find(v => v.id === "2");
            chai.assert.equal(value2.balance, 12345);
            chai.assert.isObject((value2 as any).stats, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.equal((value2 as any).stats.initialBalance, 0);
        });
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {Transaction} from "../../model/Transaction";
import {Contact} from "../../model/Contact";

describe("/v2/values/ - secret stats capability", () => {

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
            chai.assert.deepEqual((getValueResp.body as any).stats, {
                initialBalance: 1000,
                initialUsesRemaining: null
            });
        });

        it("gets initialBalance = 0 when the Value was created with a balance = 0, even if credited later", async () => {
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
            chai.assert.deepEqual((getValueResp.body as any).stats, {
                initialBalance: 0,
                initialUsesRemaining: null
            });
        });

        it("gets initialBalance = null when the Value was created with a balance = null", async () => {
            const value: Partial<Value> = {
                id: "3",
                currency: "USD",
                balanceRule: {
                    "rule": "currentLineItem.lineTotal.subtotal * 0.1",
                    "explanation": "10% off"
                },
                redemptionRule: {
                    "rule": "currentLineItem.lineTotal.discount == 0",
                    "explanation": "cannot be combined"
                },
                usesRemaining: 1
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal(getValueResp.body.id, value.id);
            chai.assert.equal(getValueResp.body.balance, null);
            chai.assert.deepEqual((getValueResp.body as any).stats, {
                initialBalance: null,
                initialUsesRemaining: 1
            });
        });

        it("gets initialBalance on claimed generic Values", async () => {
            const value: Partial<Value> = {
                id: "4",
                currency: "USD",
                balance: 500,
                usesRemaining: 20,
                code: "FREE-MONEY!",
                isGenericCode: true
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const contact: Partial<Contact> = {
                id: "claimer"
            };
            const createContactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContactResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const claimValueResp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                code: value.code,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(createContactResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const getOriginalValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getOriginalValueResp.statusCode, 200, `body=${JSON.stringify(getOriginalValueResp.body)}`);
            chai.assert.equal(getOriginalValueResp.body.id, value.id);
            chai.assert.equal(getOriginalValueResp.body.balance, 500);
            chai.assert.deepEqual((getOriginalValueResp.body as any).stats, {
                initialBalance: 500,
                initialUsesRemaining: 20
            });

            const getClaimedValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${claimValueResp.body.id}?stats=true`, "GET");
            chai.assert.equal(getClaimedValueResp.statusCode, 200, `body=${JSON.stringify(getClaimedValueResp.body)}`);
            chai.assert.equal(getClaimedValueResp.body.id, claimValueResp.body.id);
            chai.assert.equal(getClaimedValueResp.body.balance, 500);
            chai.assert.deepEqual((getClaimedValueResp.body as any).stats, {
                initialBalance: 500,
                initialUsesRemaining: 1
            });
        });
    });

    describe("getting multiple Values", () => {
        it("gets the initialBalance stats laid out above", async () => {
            const getValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id.in=1,2,3&stats=true`, "GET");
            chai.assert.equal(getValuesResp.statusCode, 200, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.lengthOf(getValuesResp.body, 3);

            const value1 = getValuesResp.body.find(v => v.id === "1");
            chai.assert.equal(value1.balance, 401);
            chai.assert.isObject((value1 as any).stats, `value1=${value1}`);
            chai.assert.deepEqual((value1 as any).stats, {
                initialBalance: 1000,
                initialUsesRemaining: null
            });

            const value2 = getValuesResp.body.find(v => v.id === "2");
            chai.assert.equal(value2.balance, 12345);
            chai.assert.isObject((value2 as any).stats, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.deepEqual((value2 as any).stats, {
                initialBalance: 0,
                initialUsesRemaining: null
            });

            const value3 = getValuesResp.body.find(v => v.id === "3");
            chai.assert.equal(value3.balance, null);
            chai.assert.isObject((value3 as any).stats, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.deepEqual((value3 as any).stats, {
                initialBalance: null,
                initialUsesRemaining: 1
            });
        });
    });
});

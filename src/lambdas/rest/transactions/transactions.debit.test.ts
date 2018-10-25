import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../utils/testUtils";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import * as currencies from "../currencies";
import {installRestRoutes} from "../installRestRoutes";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/debit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await setCodeCryptographySecrets();

        await currencies.createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    const value1: Partial<Value> = {
        id: "v-debit-1",
        currency: "CAD",
        code: "IAMASECRETCODE",
        balance: 1000
    };

    it("can debit by valueId", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-1",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 599,
            currency: "CAD"
        });

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-1",
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: "…CODE",
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 401,
                    balanceChange: -599,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 401);

        const getDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit-1", "GET");
        chai.assert.equal(getDebitResp.statusCode, 200, `body=${JSON.stringify(getDebitResp.body)}`);
        chai.assert.deepEqualExcluding(getDebitResp.body, postDebitResp.body, "statusCode");

        // check DbTransaction created by debit
        const knex = await getKnexRead();
        const res = await knex("Transactions")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: postDebitResp.body.id
            });
        chai.assert.deepEqualExcluding(
            res[0], {
                "userId": defaultTestUser.auth.userId,
                "id": "debit-1",
                "transactionType": "debit",
                "currency": "CAD",
                "lineItems": "null",
                "paymentSources": "null",
                "metadata": "null",
                "tax": "null",
                "createdBy": defaultTestUser.auth.teamMemberId,
                "nextTransactionId": null,
                "rootTransactionId": "debit-1",
                "totals_subtotal": null,
                "totals_tax": null,
                "totals_discountLightrail": null,
                "totals_paidLightrail": null,
                "totals_paidStripe": null,
                "totals_paidInternal": null,
                "totals_remainder": 0,
                "totals_marketplace_sellerGross": null,
                "totals_marketplace_sellerDiscount": null,
                "totals_marketplace_sellerNet": null
            }, ["createdDate", "totals"]
        );
    });

    it("can debit by secret code", async () => {
        const valueWithCode = {
            ...value1,
            id: generateId(),
            code: "CODE-TO-CHARGE"
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithCode);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-code-1",
            source: {
                rail: "lightrail",
                code: valueWithCode.code
            },
            amount: 1,
            currency: "CAD"
        });

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-code-1",
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: valueWithCode.id,
                    code: "…ARGE",
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 999,
                    balanceChange: -1,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueWithCode.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 999);

        const getDebitResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postDebitResp.body.id}`, "GET");
        chai.assert.equal(getDebitResp.statusCode, 200, `body=${JSON.stringify(getDebitResp.body)}`);
        chai.assert.deepEqualExcluding(getDebitResp.body, postDebitResp.body, "statusCode");
    });

    it("can debit by generic code", async () => {
        const valueWithGenericCode = {
            ...value1,
            id: generateId(),
            code: "CODE-IS-GENERIC",
            isGenericCode: true
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithGenericCode);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: "debit-code-2",
            source: {
                rail: "lightrail",
                code: valueWithGenericCode.code
            },
            amount: 1,
            currency: "CAD"
        };
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", request);

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: request.id,
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: valueWithGenericCode.id,
                    code: valueWithGenericCode.code,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 999,
                    balanceChange: -1,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueWithGenericCode.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 999);

        const getDebitResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postDebitResp.body.id}`, "GET");
        chai.assert.equal(getDebitResp.statusCode, 200, `body=${JSON.stringify(getDebitResp.body)}`);
        chai.assert.deepEqualExcluding(getDebitResp.body, postDebitResp.body, "statusCode");
    });

    it("can debit uses", async () => {
        const value = {
            id: generateId(),
            code: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "349",
                explanation: "About tree fiddy."
            },
            usesRemaining: 20
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: "debit-uses",
            source: {
                rail: "lightrail",
                code: value.code
            },
            uses: 3,
            currency: "CAD"
        };
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", request);

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: request.id,
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: "…" + value.code.slice(-4),
                    contactId: null,
                    balanceBefore: null,
                    balanceAfter: null,
                    balanceChange: null,
                    usesRemainingBefore: 20,
                    usesRemainingAfter: 17,
                    usesRemainingChange: -3
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, null);
        chai.assert.equal(getValueResp.body.usesRemaining, 17);

        const getDebitResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postDebitResp.body.id}`, "GET");
        chai.assert.equal(getDebitResp.statusCode, 200, `body=${JSON.stringify(getDebitResp.body)}`);
        chai.assert.deepEqualExcluding(getDebitResp.body, postDebitResp.body, "statusCode");
    });

    it("can debit uses and balance at the same time", async () => {
        const value = {
            id: generateId(),
            code: generateId(),
            currency: "CAD",
            balance: 2000,
            usesRemaining: 20
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: "debit-uses-and-balance",
            source: {
                rail: "lightrail",
                code: value.code
            },
            amount: 1111,
            uses: 3,
            currency: "CAD"
        };
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", request);

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: request.id,
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: "…" + value.code.slice(-4),
                    contactId: null,
                    balanceBefore: 2000,
                    balanceAfter: 889,
                    balanceChange: -1111,
                    usesRemainingBefore: 20,
                    usesRemainingAfter: 17,
                    usesRemainingChange: -3
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 889);

        const getDebitResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postDebitResp.body.id}`, "GET");
        chai.assert.equal(getDebitResp.statusCode, 200, `body=${JSON.stringify(getDebitResp.body)}`);
        chai.assert.deepEqualExcluding(getDebitResp.body, postDebitResp.body, "statusCode");
    });

    it("debiting balance does not affect uses by default", async () => {
        const valueWithUses = {
            id: generateId(),
            code: generateId(),
            currency: "CAD",
            balance: 2000,
            usesRemaining: 20
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithUses);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: "debit-balance-untouched-uses",
            source: {
                rail: "lightrail",
                code: valueWithUses.code
            },
            amount: 1000,
            currency: "CAD"
        };
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", request);

        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: request.id,
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: valueWithUses.id,
                    code: "…" + valueWithUses.code.slice(-4),
                    contactId: null,
                    balanceBefore: 2000,
                    balanceAfter: 1000,
                    balanceChange: -1000,
                    usesRemainingBefore: 20,
                    usesRemainingAfter: 20,
                    usesRemainingChange: 0
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueWithUses.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000);

        const getDebitResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${postDebitResp.body.id}`, "GET");
        chai.assert.equal(getDebitResp.statusCode, 200, `body=${JSON.stringify(getDebitResp.body)}`);
        chai.assert.deepEqualExcluding(getDebitResp.body, postDebitResp.body, "statusCode");
    });

    it("409s on reusing a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-1",   // same as above
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 100,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a debit", async () => {
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-2",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 300,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postDebitResp.statusCode, 200, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-2",
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 0
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: "…CODE",
                    contactId: null,
                    balanceBefore: 401,
                    balanceAfter: 101,
                    balanceChange: -300,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 401, "the value did not actually change");
    });

    it("can debit by too much balance with allowRemainder", async () => {
        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-balance-remainder",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 9500,
            currency: "CAD",
            allowRemainder: true
        });
        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-balance-remainder",
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 9500 - 401
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: "…CODE",
                    contactId: null,
                    balanceBefore: 401,
                    balanceAfter: 0,
                    balanceChange: -401,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);
    });

    it("can debit by too much uses with allowRemainder", async () => {
        const valueWithUses = {
            id: generateId(),
            currency: "CAD",
            balance: 2000,
            usesRemaining: 1
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithUses);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit-uses-remainder",
            source: {
                rail: "lightrail",
                valueId: valueWithUses.id
            },
            amount: 9500,
            uses: 23,
            currency: "CAD",
            allowRemainder: true
        });
        chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);
        chai.assert.deepEqualExcluding(postDebitResp.body, {
            id: "debit-uses-remainder",
            transactionType: "debit",
            currency: "CAD",
            totals: {
                remainder: 9500 - 2000
            },
            steps: [
                {
                    rail: "lightrail",
                    valueId: valueWithUses.id,
                    contactId: null,
                    code: null,
                    balanceBefore: 2000,
                    balanceAfter: 0,
                    balanceChange: -2000,
                    usesRemainingBefore: 1,
                    usesRemainingAfter: 0,
                    usesRemainingChange: -1
                }
            ],
            lineItems: null,
            paymentSources: null,
            metadata: null,
            tax: null,
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value1.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 0);
    });

    it("409s debiting with the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-4",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 301,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "WrongCurrency");
    });

    it("409s debiting more balance than is available", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-insufficient-balance",
            source: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 1301,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InsufficientBalance");
    });

    it("409s debiting more uses than is available", async () => {
        const valueWithUses = {
            id: generateId(),
            currency: "CAD",
            balance: 2000,
            usesRemaining: 1
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueWithUses);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-remainder-uses",
            source: {
                rail: "lightrail",
                valueId: valueWithUses.id
            },
            uses: 2,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InsufficientUses");
    });

    it("409s debiting balance on a Value with balance=null", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "300",
                explanation: "This is sparta!"
            }
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-balance-rule",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 500,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "NullBalance");
    });

    it("409s debiting uses on a Value with uses=null", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 7800
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-balance-rule",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 300,
            uses: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "NullUses");
    });

    it("409s debiting a Value that is canceled", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 7800
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const cancelResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "PATCH", {
            canceled: true
        });
        chai.assert.equal(cancelResp.statusCode, 200, `body=${JSON.stringify(cancelResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-canceled",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueCanceled");
    });

    it("409s debiting a Value that is frozen", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 7800
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const freezeResp = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "PATCH", {
            frozen: true
        });
        chai.assert.equal(freezeResp.statusCode, 200, `body=${JSON.stringify(freezeResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-frozen",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueFrozen");
    });

    it("409s debiting a Value that has not started yet", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 734545,
            startDate: new Date("2099-02-03")
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-not-started",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 8,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueNotStarted");
    });

    it("409s debiting a Value that has ended", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 732276,
            endDate: new Date("1999-02-03")
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-expired",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 834,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueEnded");
    });

    it("409s debiting a valueId that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-no-such-value",
            source: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1301,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("422s debiting without a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s debiting with a number transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: 123,
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s debiting a negative amount", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-negative-amount",
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: -1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s debiting negative uses", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-negative-amount",
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            uses: -1,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });
});

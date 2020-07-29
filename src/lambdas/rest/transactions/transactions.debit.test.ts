import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../../utils/testUtils";
import {formatCodeForLastFourDisplay, Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import * as currencies from "../currencies";
import {installRestRoutes} from "../installRestRoutes";
import {getKnexRead, getKnexWrite} from "../../../utils/dbUtils/connection";
import {DebitRequest} from "../../../model/TransactionRequest";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import chaiExclude from "chai-exclude";

chai.use(chaiExclude);

describe("/v2/transactions/debit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();

        await currencies.createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
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
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.deepEqual(getDebitResp.body, postDebitResp.body);

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
                "lineItems": null,
                "paymentSources": null,
                "pendingVoidDate": null,
                "metadata": null,
                "tax": null,
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
                "totals_forgiven": null,
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
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.deepEqual(getDebitResp.body, postDebitResp.body);
    });

    it("can debit by generic code", async () => {
        const valueWithGenericCode = {
            ...value1,
            id: generateId(),
            code: "CODE-IS-GENERIC",
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: 1,
                    usesRemaining: null
                }
            }
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
                    code: formatCodeForLastFourDisplay(valueWithGenericCode.code),
                    contactId: null,
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.deepEqual(getDebitResp.body, postDebitResp.body);
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
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.deepEqual(getDebitResp.body, postDebitResp.body);
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
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.deepEqual(getDebitResp.body, postDebitResp.body);
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
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.deepEqual(getDebitResp.body, postDebitResp.body);
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
            simulated: true,
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: "…CODE",
                    contactId: null,
                    balanceRule: null,
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
            pending: false,
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
                    balanceRule: null,
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
            pending: false,
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
                    balanceRule: null,
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
            pending: false,
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
        chai.assert.equal(resp.body.messageCode, "InsufficientUsesRemaining");
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
            currency: "CAD"
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
            currency: "CAD"
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
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s debiting a huge amount", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/debit", "POST", {
            id: "debit-negative-amount",
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 999999999999,
            currency: "CAD"
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
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    describe("max id length checks", () => {
        const value: Partial<Value> = {
            id: generateId(64),
            currency: "CAD",
            balance: 50,
        };

        before(async function () {
            const createValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
            chai.assert.equal(createValue.statusCode, 201, JSON.stringify(createValue));
        });

        it("can create debit with maximum id length", async () => {
            const debit: Partial<DebitRequest> = {
                id: generateId(64),
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 1,
                currency: "CAD"
            };
            const createDebit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit);
            chai.assert.equal(createDebit.statusCode, 201, `body=${JSON.stringify(createDebit.body)}`);
        });

        it("cannot create debit with id exceeding max length of 64 - 422s", async () => {
            const debit: Partial<DebitRequest> = {
                id: generateId(65),
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 1,
                currency: "CAD"
            };
            const createDebit = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/debit", "POST", debit);
            chai.assert.equal(createDebit.statusCode, 422, `body=${JSON.stringify(createDebit.body)}`);
            chai.assert.include(createDebit.body.message, "requestBody.id does not meet maximum length of 64");
        });
    });

    describe("pending transactions", () => {
        it("can create and void a pending transaction", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);
            chai.assert.isNotNull(pendingDebitRes.body.pendingVoidDate);

            const getPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}`, "GET");
            chai.assert.equal(getPendingDebitRes.statusCode, 200, `body=${JSON.stringify(getPendingDebitRes.body)}`);
            chai.assert.deepEqual(getPendingDebitRes.body, pendingDebitRes.body);

            const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valuePendingRes.body.balance, 40);

            const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                id: generateId()
            });
            chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
            chai.assert.isNotTrue(voidRes.body.pending);

            const getVoidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${voidRes.body.id}`, "GET");
            chai.assert.equal(getVoidRes.statusCode, 200, `body=${JSON.stringify(getVoidRes.body)}`);
            chai.assert.deepEqual(getVoidRes.body, voidRes.body);

            const valueVoidRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valueVoidRes.body.balance, 50);
        });

        it("can create and capture a pending transaction", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);
            chai.assert.isNotNull(pendingDebitRes.body.pendingVoidDate);

            const getPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}`, "GET");
            chai.assert.equal(getPendingDebitRes.statusCode, 200, `body=${JSON.stringify(getPendingDebitRes.body)}`);
            chai.assert.deepEqual(getPendingDebitRes.body, pendingDebitRes.body);

            const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valuePendingRes.body.balance, 40);

            const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                id: generateId()
            });
            chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
            chai.assert.isNotTrue(captureRes.body.pending);

            const getCaptureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${captureRes.body.id}`, "GET");
            chai.assert.equal(getCaptureRes.statusCode, 200, `body=${JSON.stringify(getCaptureRes.body)}`);
            chai.assert.deepEqual(getCaptureRes.body, captureRes.body);

            const valueCaptureRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valueCaptureRes.body.balance, 40);
        });

        it("can simulate pending", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: true,
                simulate: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 200, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);
            chai.assert.isTrue(pendingDebitRes.body.simulated);
            chai.assert.isNotNull(pendingDebitRes.body.pendingVoidDate);

            const getPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}`, "GET");
            chai.assert.equal(getPendingDebitRes.statusCode, 404, `body=${JSON.stringify(getPendingDebitRes.body)}`);
        });

        it("can set the pending duration", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: "P14D"
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);
            const expectedPendingVoidDate = new Date(pendingDebitRes.body.createdDate);
            expectedPendingVoidDate.setDate(expectedPendingVoidDate.getDate() + 14);
            chai.assert.equal(pendingDebitRes.body.pendingVoidDate as any as string, expectedPendingVoidDate.toISOString(), `pendingVoidDate should be 14 days ahead of createdDate '${pendingDebitRes.body.createdDate}'`);

            const getPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}`, "GET");
            chai.assert.equal(getPendingDebitRes.statusCode, 200, `body=${JSON.stringify(getPendingDebitRes.body)}`);
            chai.assert.deepEqual(getPendingDebitRes.body, pendingDebitRes.body);

            const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valuePendingRes.body.balance, 40);
        });

        it("can create and void a pending debit with remainder", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 100,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                allowRemainder: true,
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.equal(pendingDebitRes.body.totals.remainder, 50);
            chai.assert.isTrue(pendingDebitRes.body.pending);
            chai.assert.isNotNull(pendingDebitRes.body.pendingVoidDate);

            const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valuePendingRes.body.balance, 0);

            const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                id: generateId()
            });
            chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
            chai.assert.isNotTrue(voidRes.body.pending);

            const valueVoidRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valueVoidRes.body.balance, 50);
        });

        it("can create and capture a debit with remainder", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 100,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                allowRemainder: true,
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.equal(pendingDebitRes.body.totals.remainder, 50);
            chai.assert.isTrue(pendingDebitRes.body.pending);
            chai.assert.isNotNull(pendingDebitRes.body.pendingVoidDate);

            const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(valuePendingRes.body.balance, 0);

            const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                id: generateId()
            });
            chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
            chai.assert.isNotTrue(captureRes.body.pending);
        });

        it("can't set pending to a negative duration", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: "P-1D"
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 422, `body=${JSON.stringify(pendingDebitRes.body)}`);
        });

        it("can't set pending too far into the future", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: "P100Y"
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 422, `body=${JSON.stringify(pendingDebitRes.body)}`);
        });

        it("can't capture or void an already captured transaction", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);

            const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                id: generateId()
            });
            chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
            chai.assert.isNotTrue(captureRes.body.pending);

            const failCaptureRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                id: generateId()
            });
            chai.assert.equal(failCaptureRes.statusCode, 409, `body=${JSON.stringify(failCaptureRes.body)}`);
            chai.assert.equal(failCaptureRes.body.messageCode, "TransactionCaptured");

            const failVoidRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                id: generateId()
            });
            chai.assert.equal(failVoidRes.statusCode, 409, `body=${JSON.stringify(failVoidRes.body)}`);
            chai.assert.equal(failVoidRes.body.messageCode, "TransactionCaptured");
        });

        it("can't capture or void an already voided transaction", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);

            const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                id: generateId()
            });
            chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
            chai.assert.isNotTrue(voidRes.body.pending);

            const failCaptureRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                id: generateId()
            });
            chai.assert.equal(failCaptureRes.statusCode, 409, `body=${JSON.stringify(failCaptureRes.body)}`);
            chai.assert.equal(failCaptureRes.body.messageCode, "TransactionVoided");

            const failVoidRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                id: generateId()
            });
            chai.assert.equal(failVoidRes.statusCode, 409, `body=${JSON.stringify(failVoidRes.body)}`);
            chai.assert.equal(failVoidRes.body.messageCode, "TransactionVoided");
        });

        it("can't capture a transaction whose pendingVoidDate has passed", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: "CAD",
                balance: 50,
            };
            const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

            const pendingDebitTx: DebitRequest = {
                id: generateId(),
                amount: 10,
                currency: "CAD",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                pending: true
            };
            const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
            chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
            chai.assert.isTrue(pendingDebitRes.body.pending);

            const passedPendingVoidDate = nowInDbPrecision();
            passedPendingVoidDate.setDate(passedPendingVoidDate.getDate() - 1);
            const knex = await getKnexWrite();
            await knex("Transactions")
                .where({id: pendingDebitTx.id})
                .update({pendingVoidDate: passedPendingVoidDate});

            const failCaptureRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                id: generateId()
            });
            chai.assert.equal(failCaptureRes.statusCode, 409, `body=${JSON.stringify(failCaptureRes.body)}`);
            chai.assert.equal(failCaptureRes.body.messageCode, "TransactionVoiding");
        });

        describe("with frozen values", () => {
            it("can void a transaction with a frozen value", async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "CAD",
                    balance: 500,
                };
                const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

                const pendingDebitTx: DebitRequest = {
                    id: generateId(),
                    amount: 100,
                    currency: "CAD",
                    source: {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    pending: true
                };
                const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
                chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
                chai.assert.isTrue(pendingDebitRes.body.pending);

                const freezeRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {frozen: true});
                chai.assert.equal(freezeRes.statusCode, 200, `body=${JSON.stringify(freezeRes.body)}`);
                chai.assert.isTrue(freezeRes.body.frozen);

                const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                    id: generateId()
                });
                chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
            });

            it("can't capture a transaction with a frozen value", async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "CAD",
                    balance: 500,
                };
                const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

                const pendingDebitTx: DebitRequest = {
                    id: generateId(),
                    amount: 100,
                    currency: "CAD",
                    source: {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    pending: true
                };
                const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
                chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
                chai.assert.isTrue(pendingDebitRes.body.pending);

                const freezeRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {frozen: true});
                chai.assert.equal(freezeRes.statusCode, 200, `body=${JSON.stringify(freezeRes.body)}`);
                chai.assert.isTrue(freezeRes.body.frozen);

                const failCaptureRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                    id: generateId()
                });
                chai.assert.equal(failCaptureRes.statusCode, 409, `body=${JSON.stringify(failCaptureRes.body)}`);
                chai.assert.equal(failCaptureRes.body.messageCode, "ValueFrozen");
            });
        });

        describe("with canceled values", () => {
            it("can void a transaction with a canceled value", async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "CAD",
                    balance: 500,
                };
                const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

                const pendingDebitTx: DebitRequest = {
                    id: generateId(),
                    amount: 100,
                    currency: "CAD",
                    source: {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    pending: true
                };
                const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
                chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
                chai.assert.isTrue(pendingDebitRes.body.pending);

                const cancelRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {canceled: true});
                chai.assert.equal(cancelRes.statusCode, 200, `body=${JSON.stringify(cancelRes.body)}`);
                chai.assert.isTrue(cancelRes.body.canceled);

                const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingDebitTx.id}/void`, "POST", {
                    id: generateId()
                });
                chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
            });

            it("can capture a transaction with a canceled value", async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "CAD",
                    balance: 500,
                };
                const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

                const pendingDebitTx: DebitRequest = {
                    id: generateId(),
                    amount: 100,
                    currency: "CAD",
                    source: {
                        rail: "lightrail",
                        valueId: value.id
                    },
                    pending: true
                };
                const pendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pendingDebitTx);
                chai.assert.equal(pendingDebitRes.statusCode, 201, `body=${JSON.stringify(pendingDebitRes.body)}`);
                chai.assert.isTrue(pendingDebitRes.body.pending);

                const cancelRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {canceled: true});
                chai.assert.equal(cancelRes.statusCode, 200, `body=${JSON.stringify(cancelRes.body)}`);
                chai.assert.isTrue(cancelRes.body.canceled);

                const captureRes = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${pendingDebitTx.id}/capture`, "POST", {
                    id: generateId()
                });
                chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
            });
        });
    });
});

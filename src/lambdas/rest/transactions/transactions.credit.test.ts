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

describe("/v2/transactions/credit", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await setCodeCryptographySecrets();

        await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    const value1: Partial<Value> = {
        id: generateId(),
        currency: "CAD",
        balance: 0
    };

    it("can credit by valueId", async () => {
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: "credit-1",
            destination: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 1000,
            currency: "CAD"
        });
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: "credit-1",
            transactionType: "credit",
            currency: "CAD",
            totals: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 1000,
                    balanceChange: 1000,
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
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000);

        const getCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit-1", "GET");
        chai.assert.equal(getCreditResp.statusCode, 200, `body=${JSON.stringify(getCreditResp.body)}`);
        chai.assert.deepEqualExcluding(getCreditResp.body, postCreditResp.body, "statusCode");

        // check DbTransaction created by credit
        const knex = await getKnexRead();
        const res = await knex("Transactions")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: postCreditResp.body.id
            });
        chai.assert.deepEqualExcluding(
            res[0], {
                "userId": "default-test-user-TEST",
                "id": "credit-1",
                "transactionType": "credit",
                "currency": "CAD",
                "lineItems": "null",
                "paymentSources": "null",
                "metadata": "null",
                "tax": "null",
                "createdBy": "default-test-user-TEST",
                "totals_subtotal": null,
                "totals_tax": null,
                "totals_discountLightrail": null,
                "totals_paidLightrail": null,
                "totals_paidStripe": null,
                "totals_paidInternal": null,
                "totals_remainder": null,
                "totals_marketplace_sellerGross": null,
                "totals_marketplace_sellerDiscount": null,
                "totals_marketplace_sellerNet": null
            }, ["createdDate", "totals"]
        );
    });

    it("can credit by secret code", async () => {
        const valueSecretCode: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 0,
            code: "SUPER-SECRET"
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueSecretCode);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: "01234567890123456789012345678901", // 32 characters
            destination: {
                rail: "lightrail",
                code: valueSecretCode.code
            },
            amount: 1000,
            currency: "CAD"
        };

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", request);
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: request.id,
            transactionType: "credit",
            currency: "CAD",
            totals: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: valueSecretCode.id,
                    code: "…CRET",
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 1000,
                    balanceChange: 1000,
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

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueSecretCode.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000);

        const getCreditResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCreditResp.statusCode, 200, `body=${JSON.stringify(getCreditResp.body)}`);
        chai.assert.deepEqualExcluding(getCreditResp.body, postCreditResp.body, "statusCode");
    });

    it("can credit by generic code", async () => {
        const valueGenericCode: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 0,
            code: "SUPER-GENERIC",
            isGenericCode: true
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueGenericCode);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: generateId(),
            destination: {
                rail: "lightrail",
                code: valueGenericCode.code
            },
            amount: 1000,
            currency: "CAD"
        };

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", request);
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: request.id,
            transactionType: "credit",
            currency: "CAD",
            totals: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: valueGenericCode.id,
                    code: valueGenericCode.code,
                    contactId: null,
                    balanceBefore: 0,
                    balanceAfter: 1000,
                    balanceChange: 1000,
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

        const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueGenericCode.id}`, "GET");
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 1000);

        const getCreditResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCreditResp.statusCode, 200, `body=${JSON.stringify(getCreditResp.body)}`);
        chai.assert.deepEqualExcluding(getCreditResp.body, postCreditResp.body, "statusCode");
    });

    it("can credit uses", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balanceRule: {
                rule: "349",
                explanation: "About tree fiddy."
            },
            usesRemaining: 0
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: generateId(),
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            uses: 2,
            currency: "CAD"
        };

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", request);
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: request.id,
            transactionType: "credit",
            currency: "CAD",
            totals: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: null,
                    balanceAfter: null,
                    balanceChange: 0,
                    usesRemainingBefore: 0,
                    usesRemainingAfter: 2,
                    usesRemainingChange: 2
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
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, null);
        chai.assert.equal(getValueResp.body.usesRemaining, 2);

        const getCreditResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCreditResp.statusCode, 200, `body=${JSON.stringify(getCreditResp.body)}`);
        chai.assert.deepEqualExcluding(getCreditResp.body, postCreditResp.body, "statusCode");
    });

    it("can credit balance and uses at the same time", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 349,
            usesRemaining: 3
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: generateId(),
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 101,
            uses: 1,
            currency: "CAD"
        };

        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", request);
        chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: request.id,
            transactionType: "credit",
            currency: "CAD",
            totals: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 349,
                    balanceAfter: 450,
                    balanceChange: 101,
                    usesRemainingBefore: 3,
                    usesRemainingAfter: 4,
                    usesRemainingChange: 1
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
        chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(postValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, 450);
        chai.assert.equal(getValueResp.body.usesRemaining, 4);

        const getCreditResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCreditResp.statusCode, 200, `body=${JSON.stringify(getCreditResp.body)}`);
        chai.assert.deepEqualExcluding(getCreditResp.body, postCreditResp.body, "statusCode");
    });

    it("409s on reusing a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-1",  // same as above
            destination: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 1350,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "TransactionExists");
    });

    it("can simulate a credit by valueId", async () => {
        const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: "credit-2",
            destination: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 1100,
            currency: "CAD",
            simulate: true
        });
        chai.assert.equal(postCreditResp.statusCode, 200, `body=${JSON.stringify(postCreditResp.body)}`);
        chai.assert.deepEqualExcluding(postCreditResp.body, {
            id: "credit-2",
            transactionType: "credit",
            currency: "CAD",
            totals: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: value1.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 2100,
                    balanceChange: 1100,
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
        chai.assert.equal(getValueResp.body.balance, 1000, "value did not actually change");
    });

    it("409s crediting with the wrong currency", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-3",
            destination: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "WrongCurrency");
    });

    it("409s crediting balance on a Value with balance=null", async () => {
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

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "debit-balance-rule",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 500,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "NullBalance");
    });

    it("409s crediting uses on a Value with uses=null", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 7800
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "debit-balance-rule",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            uses: 1,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "NullUses");
    });

    it("409s crediting a Value that is canceled", async () => {
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

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-canceled",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueCanceled");
    });

    it("409s crediting a Value that is frozen", async () => {
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

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-frozen",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 300,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueFrozen");
    });

    it("409s crediting a Value that has not started yet", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 734545,
            startDate: new Date("2099-02-03")
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-not-started",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 8,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueNotStarted");
    });

    it("409s crediting a Value that has ended", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 732276,
            endDate: new Date("1999-02-03")
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-expired",
            destination: {
                rail: "lightrail",
                valueId: value.id
            },
            amount: 834,
            currency: "CAD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueEnded");
    });

    it("409s crediting a value that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            id: "credit-4",
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "InvalidParty");
    });

    it("422s crediting without a transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
            destination: {
                rail: "lightrail",
                valueId: "idontexist"
            },
            amount: 1500,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s crediting with an invalid transactionId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/credit", "POST", {
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
});

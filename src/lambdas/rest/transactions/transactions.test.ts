import * as giftbitRoutes from "giftbit-cassava-routes";
import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {alternateTestUser, defaultTestUser} from "../../../utils/testUtils";
import * as currencies from "../currencies";
import {DbTransaction, Transaction} from "../../../model/Transaction";
import {DebitRequest, TransferRequest} from "../../../model/TransactionRequest";
import {Value} from "../../../model/Value";
import {installRestRoutes} from "../installRestRoutes";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRestRoutes(router);

        await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    const value1: Partial<Value> = {
        id: "vs-gc-1",
        currency: "CAD",
        balance: 1000
    };
    const value2: Partial<Value> = {
        id: "vs-gc-2",
        currency: "CAD",
        balance: 0
    };
    const transfer1: Partial<TransferRequest> = {
        id: "transfer-1",
        currency: "CAD",
        amount: 1,
        source: {
            rail: "lightrail",
            valueId: "vs-gc-1",
        },
        destination: {
            rail: "lightrail",
            valueId: "vs-gc-2"
        }
    };
    const debit1: Partial<DebitRequest> = {
        id: "tx-1",
        source: {
            rail: "lightrail",
            valueId: value1.id
        },
        amount: 2,
        currency: "CAD"
    };
    const debit2: Partial<DebitRequest> = {
        id: "tx-2",
        source: {
            rail: "lightrail",
            valueId: value1.id
        },
        amount: 2,
        currency: "CAD",
        metadata: {
            "light": "rail"
        }
    };
    const transfer2: DbTransaction = {
        userId: "test-user-a",
        id: "transfer-2",
        transactionType: "transfer",
        currency: "CAD",
        totals: null,
        lineItems: null,
        paymentSources: null,
        createdDate: new Date("01 January 2000"),
        metadata: null
    };
    const transfer3: DbTransaction = {
        userId: "test-user-a",
        id: "transfer-3",
        transactionType: "transfer",
        currency: "CAD",
        totals: null,
        lineItems: null,
        paymentSources: null,
        createdDate: new Date("01 January 2005"),
        metadata: null
    };
    const checkout1 = {
        id: "checkout-1",
        sources: [
            {
                rail: "lightrail",
                valueId: value1.id
            },
            {
                rail: "lightrail",
                valueId: value2.id
            }
        ],
        lineItems: [
            {
                type: "product",
                productId: "xyz-123",
                unitPrice: 50
            }
        ],
        currency: "CAD"
    };


    it("can retrieve 0 transactions", async () => {
        const resp = await testUtils.testAuthedRequest(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    it("can retrieve 2 transactions with 2 steps", async () => {
        const postValueResp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1);
        chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
        const postValueResp2 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2);
        chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

        const transferResp = await testUtils.testAuthedRequest<Value>(router, "/v2/transactions/transfer", "POST", transfer1);
        chai.assert.equal(transferResp.statusCode, 201, `body=${JSON.stringify(transferResp.body)}`);

        const resp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 2);
        chai.assert.deepInclude(resp.body, transferResp.body);
    });

    it("can retrieve 3 transactions (1 or 2 steps)", async () => {
        const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit1);
        chai.assert.equal(debitResp.statusCode, 201, `body=${JSON.stringify(debitResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 3);
        chai.assert.deepInclude(resp.body, debitResp.body);
    });

    it("can get a transaction by id", async () => {
        const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transfer1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.id, transfer1.id, `body=${JSON.stringify(resp.body)}`);
    });

    it("can get a transaction with metadata", async () => {
        const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit2);
        chai.assert.equal(debitResp.statusCode, 201, `body=${JSON.stringify(debitResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${debit2.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(JSON.stringify(resp.body.metadata), JSON.stringify(debit2.metadata), `body=${JSON.stringify(resp.body)}`);
    });

    it("orders transactions by date created", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);  // TODO 6 once filter tests are back in: transfer2 first, transfer3 second

        const ids = resp.body.map(t => t.id);
        chai.assert.include(ids, transfer1.id);
        chai.assert.include(ids, debit1.id);
        chai.assert.include(ids, debit2.id);
    });

    it("404s on getting an invalid id", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions/iamnotavalidtransactionid", "GET");
        chai.assert.equal(resp.statusCode, 404, `body=${JSON.stringify(resp.body)}`);
    });

    it("can't modify a transaction", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${debit1.id}`, "PATCH", {
            amount: 100,
            currency: "USD"
        });
        chai.assert.equal(resp.statusCode, 403, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CannotModifyTransaction");
    });

    it("can't delete a transaction", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/transactions/${debit1.id}`, "DELETE");
        chai.assert.equal(resp.statusCode, 403, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "CannotDeleteTransaction");
    });

    describe("userId isolation", () => {
        it("doesn't leak /transactions", async () => {
            const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/transactions", "GET");
            chai.assert.equal(resp1.statusCode, 200);
            chai.assert.equal(resp1.body.length, 4);  // TODO 6 once filter tests are back in

            const resp2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions", "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));

            chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
            chai.assert.deepEqual(JSON.parse(resp2.body), []);
            chai.assert.equal(resp2.headers["Limit"], "100");
            chai.assert.equal(resp2.headers["Max-Limit"], "1000");
        });

        it("doesn't leak GET /transactions/{id}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/transactions/${debit1.id}`, "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 404, `body=${JSON.stringify(resp.body)}`);
        });

        it("doesn't leak transaction steps", async () => {
            await currencies.createCurrency(alternateTestUser.auth, {
                code: "CAD",
                name: "Canadian bucks",
                symbol: "$",
                decimalPlaces: 2
            });


            const postValueResp1 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
                headers: {Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`},
                body: JSON.stringify(value1)
            }));
            chai.assert.equal(postValueResp1.statusCode, 201, `body=${JSON.stringify(postValueResp1.body)}`);
            const postValueResp2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
                headers: {Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`},
                body: JSON.stringify(value2)
            }));
            chai.assert.equal(postValueResp2.statusCode, 201, `body=${JSON.stringify(postValueResp2.body)}`);

            const transferResp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/transfer", "POST", {
                headers: {Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`},
                body: JSON.stringify(transfer1)
            }));
            chai.assert.equal(transferResp.statusCode, 201, `body=${JSON.stringify(transferResp.body)}`);

            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/transactions/${transfer1.id}`, "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));
            chai.assert.equal(JSON.parse(resp.body).id, transfer1.id);
            chai.assert.equal(JSON.parse(resp.body).steps.length, 2);
        });
    });

    describe("handles 'checkout' transactions", () => {
        it("reads all checkout properties from from db", async () => {
            const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkout1);
            chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);

            const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout1.id}`, "GET");
            chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
            chai.assert.deepEqualExcluding(getCheckoutResp.body, {
                id: "checkout-1",
                transactionType: "checkout",
                currency: "CAD",
                totals: {
                    subtotal: 50,
                    tax: 0,
                    discount: 0,
                    payable: 50,
                    remainder: 0
                },
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: 50,
                        quantity: 1,
                        lineTotal: {
                            subtotal: 50,
                            taxable: 50,
                            tax: 0,
                            discount: 0,
                            payable: 50,
                            remainder: 0
                        }
                    }
                ],
                steps: [
                    {
                        rail: "lightrail",
                        valueId: value1.id,
                        code: null,
                        contactId: null,
                        balanceBefore: 995,
                        balanceAfter: 945,
                        balanceChange: -50
                    }
                ],
                paymentSources: [
                    {
                        "rail": "lightrail",
                        "valueId": "vs-gc-1"
                    },
                    {
                        "rail": "lightrail",
                        "valueId": "vs-gc-2"
                    }
                ],
                metadata: null,
                createdDate: null
            }, "createdDate");
        });
    });
});

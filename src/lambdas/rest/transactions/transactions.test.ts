import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {alternateTestUser, defaultTestUser, generateId} from "../../../utils/testUtils";
import * as currencies from "../currencies";
import {Transaction} from "../../../model/Transaction";
import {CreditRequest, DebitRequest, TransferRequest} from "../../../model/TransactionRequest";
import {Value} from "../../../model/Value";
import {installRestRoutes} from "../installRestRoutes";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../utils/dbUtils";

chai.use(chaiExclude);

describe("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await currencies.createCurrency(defaultTestUser.auth, {
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

        const transferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", transfer1);
        chai.assert.equal(transferResp.statusCode, 201, `body=${JSON.stringify(transferResp.body)}`);

        const resp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 3);
        chai.assert.sameMembers(resp.body.map(tx => tx.transactionType), ["initialBalance", "initialBalance", "transfer"]);
        chai.assert.deepInclude(resp.body, transferResp.body, `resp.body=${JSON.stringify(resp.body, null, 4)}`);
    });

    it("can retrieve 4 transactions (1 or 2 steps)", async () => {
        const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", debit1);
        chai.assert.equal(debitResp.statusCode, 201, `body=${JSON.stringify(debitResp.body)}`);

        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/transactions", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);
        chai.assert.deepInclude(resp.body, debitResp.body, `resp.body=${JSON.stringify(resp.body, null, 4)}`);
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
        chai.assert.equal(resp.body.length, 5);

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

    it("treats valueId as case sensitive", async () => {
        const tx1: Partial<CreditRequest> = {
            id: generateId() + "-A",
            destination: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 2,
            currency: "CAD"
        };
        const tx2: Partial<CreditRequest> = {
            id: tx1.id.toLowerCase(),
            destination: {
                rail: "lightrail",
                valueId: value1.id
            },
            amount: 2,
            currency: "CAD"
        };
        chai.assert.notEqual(tx1.id, tx2.id);

        const postTx1Resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", tx1);
        chai.assert.equal(postTx1Resp.statusCode, 201, postTx1Resp.bodyRaw);

        const postTx2Resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", tx2);
        chai.assert.equal(postTx2Resp.statusCode, 201, postTx2Resp.bodyRaw);

        const getTx1Resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${tx1.id}`, "GET");
        chai.assert.equal(getTx1Resp.statusCode, 200);
        chai.assert.equal(getTx1Resp.body.id, tx1.id);

        const getTx2Resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${tx2.id}`, "GET");
        chai.assert.equal(getTx2Resp.statusCode, 200);
        chai.assert.equal(getTx2Resp.body.id, tx2.id);
        chai.assert.notEqual(getTx1Resp.body.id, getTx2Resp.body.id);

        const getTxs1Resp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?id=${tx1.id}`, "GET");
        chai.assert.equal(getTxs1Resp.statusCode, 200);
        chai.assert.deepEqual(getTxs1Resp.body, [getTx1Resp.body]);

        const getTxs2Resp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?id=${tx2.id}`, "GET");
        chai.assert.equal(getTxs2Resp.statusCode, 200);
        chai.assert.deepEqual(getTxs2Resp.body, [getTx2Resp.body]);
    });

    describe("userId isolation", () => {
        it("doesn't leak /transactions", async () => {
            const resp1 = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions", "GET");
            chai.assert.equal(resp1.statusCode, 200);
            chai.assert.isAtLeast(resp1.body.length, 1);

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
                decimalPlaces: 2,
                createdDate: nowInDbPrecision(),
                updatedDate: nowInDbPrecision(),
                createdBy: testUtils.defaultTestUser.teamMemberId
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
                    discountLightrail: 0,
                    payable: 50,
                    paidInternal: 0,
                    paidLightrail: 50,
                    paidStripe: 0,
                    remainder: 0,
                    forgiven: 0,
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
                        valueId: "vs-gc-2",
                        code: null,
                        contactId: null,
                        balanceRule: null,
                        balanceAfter: 0,
                        balanceBefore: 1,
                        balanceChange: -1,
                        usesRemainingBefore: null,
                        usesRemainingAfter: null,
                        usesRemainingChange: null
                    },
                    {
                        rail: "lightrail",
                        valueId: value1.id,
                        code: null,
                        contactId: null,
                        balanceRule: null,
                        balanceBefore: 999,
                        balanceAfter: 950,
                        balanceChange: -49,
                        usesRemainingBefore: null,
                        usesRemainingAfter: null,
                        usesRemainingChange: null
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
                pending: false,
                metadata: null,
                tax: {
                    "roundingMode": "HALF_EVEN"
                },
                createdDate: null,
                createdBy: defaultTestUser.auth.teamMemberId,
                tags: []
            }, ["createdDate", "createdBy"]);
        });
    });

    it(`default sorting createdDate`, async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 50
        };

        const createValueResponse = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResponse.statusCode, 201);

        const idAndDates = [
            {id: generateId(), createdDate: new Date("3030-02-01")},
            {id: generateId(), createdDate: new Date("3030-02-02")},
            {id: generateId(), createdDate: new Date("3030-02-03")},
            {id: generateId(), createdDate: new Date("3030-02-04")}
        ];
        for (const idAndDate of idAndDates) {
            const response = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: idAndDate.id,
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 1,
                currency: "CAD"
            });
            chai.assert.equal(response.statusCode, 201, `body=${JSON.stringify(response.body)}`);
            const knex = await getKnexWrite();
            const res: number = await knex("Transactions")
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: idAndDate.id,
                })
                .update(
                    Transaction.toDbTransaction(
                        testUtils.defaultTestUser.auth,
                        {
                            ...response.body,
                            createdDate: idAndDate.createdDate
                        },
                        response.body.id
                    )
                );
            if (res === 0) {
                chai.assert.fail(`No row updated. Test data failed during setup..`);
            }
        }
        const resp = await testUtils.testAuthedRequest<Transaction[]>(router, "/v2/transactions?transactionType=debit&createdDate.gt=3030-01-01", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);
        chai.assert.sameOrderedMembers(resp.body.map(tx => tx.id), idAndDates.reverse().map(tx => tx.id) /* reversed since createdDate desc*/);
    });

    describe("whitespace handling", () => {
        let value: Value;
        before(async function () {
            await testUtils.createUSD(router);
            value = await testUtils.createUSDValue(router);
        });

        it("422s creating transactionIds to be created with leading/trailing whitespace", async () => {
            const txLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                id: `\n${testUtils.generateId()}`,
                currency: "USD",
                lineItems: [{unitPrice: 1}],
                sources: [{rail: "lightrail", valueId: value.id}]
            });
            chai.assert.equal(txLeadingResp.statusCode, 422, `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);

            const txTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                id: `${testUtils.generateId()}\n`,
                currency: "USD",
                lineItems: [{unitPrice: 1}],
                sources: [{rail: "lightrail", valueId: value.id}]
            });
            chai.assert.equal(txTrailingResp.statusCode, 422, `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
        });

        it("404s when looking up a transaction by id with leading/trailing whitespace", async () => {
            const txId = testUtils.generateId();
            const txResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: txId,
                currency: "USD",
                lineItems: [{unitPrice: 1}],
                sources: [{rail: "lightrail", valueId: value.id}]
            });
            chai.assert.equal(txResp.statusCode, 201, `txResp.body=${JSON.stringify(txResp.body)}`);
            chai.assert.equal(txResp.body.id, txId, `txResp.body=${JSON.stringify(txResp.body)}`);

            const fetchLeadingResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/%20${txId}`, "GET");
            chai.assert.equal(fetchLeadingResp.statusCode, 404, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
            const fetchTrailingResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${txId}%20`, "GET");
            chai.assert.equal(fetchTrailingResp.statusCode, 404, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
        });
    });
});

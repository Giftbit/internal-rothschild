import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../utils/testUtils";
import * as currencies from "../currencies";
import {Transaction} from "../../../model/Transaction";
import {Value} from "../../../model/Value";
import {installRestRoutes} from "../installRestRoutes";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../utils/dbUtils";

chai.use(chaiExclude);

describe("/v2/transactions", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
    });

    /** This method is called at the start of each test. Since there is a filtering test that
     * runs a lot of queries on the same dataset this method is used, rather than a beforeEach. */
    async function resetDbAndAddCurrencies(): Promise<void> {
        await testUtils.resetDb();
        await currencies.createCurrency(defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
        });
        await currencies.createCurrency(defaultTestUser.auth, {
            code: "USD",
            name: "US Donairs",
            symbol: "D",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
        });
    }

    it("can filter by valueId", async () => {
        await resetDbAndAddCurrencies();
        let createdValues: Value[] = [];
        for (let i = 0; i < 3; i++) {
            const newValue = {
                id: generateId(),
                currency: "CAD",
                balance: 10 + i
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", newValue);
            chai.assert.equal(createValue.statusCode, 201);
            createdValues.push(createValue.body);
        }

        const resp1 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${createdValues[0].id}`, "GET");
        chai.assert.equal(resp1.body.length, 1);
        chai.assert.equal(resp1.body[0].id, createdValues[0].id);

        const resp2 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${createdValues[0].id}/transactions`, "GET");
        chai.assert.deepEqual(resp2.body, resp1.body);
    });

    it("does not leak other Lightrail user's data when filtering by valueId", async () => {
        await resetDbAndAddCurrencies();
        // user 1
        const value1User1 = {
            id: generateId() + "a",
            currency: "USD",
            balance: 1
        };
        const value2User1 = {
            id: generateId() + "b",
            currency: "USD",
            balance: 2
        };
        const createValue1User1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value1User1);
        chai.assert.equal(createValue1User1.statusCode, 201);
        const createValue2User1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value2User1);
        chai.assert.equal(createValue2User1.statusCode, 201);

        // user 2
        await currencies.createCurrency(testUtils.alternateTestUser.auth, {
            code: "USD",
            name: "US Donairs",
            symbol: "D",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
        });
        const value1User2_newId = {
            id: generateId() + "c",
            currency: "USD",
            balance: 3
        };
        const value1User2_sameIdAsValue1User1 = {
            id: value1User1.id,
            currency: "USD",
            balance: 4
        };
        const createValueUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
            },
            body: JSON.stringify(value1User2_newId)
        }));
        chai.assert.equal(createValueUser2.statusCode, 201);
        const createValue2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
            },
            body: JSON.stringify(value1User2_sameIdAsValue1User1)
        }));
        chai.assert.equal(createValue2.statusCode, 201);

        // user 1 list transactions
        const listTransactions = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions`, "GET");
        chai.assert.equal(listTransactions.body.length, 2);
        chai.assert.notInclude(listTransactions.body.map(tx => tx.id), value1User2_newId.id);
        chai.assert.sameMembers([value1User1.balance, value2User1.balance], listTransactions.body.map(tx => (tx.steps[0]["balanceAfter"])));

        // user 1 filter for value1
        const filterForValue1 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value1User1.id}`, "GET");
        chai.assert.equal(filterForValue1.body.length, 1);
        chai.assert.equal(filterForValue1.body[0].id, createValue1User1.body.id);
    });

    describe("filtering queries", () => {
        let transactionsUSD: Transaction[] = [];
        let transactionsCAD: Transaction[] = [];
        // setup data
        before(async function () {
            await resetDbAndAddCurrencies();
            for (let i = 0; i < 2; i++) {
                const usdValue: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 50
                };
                const createValueUSD = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", usdValue);
                chai.assert.equal(createValueUSD.statusCode, 201);

                const getTransactionUSD = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${usdValue.id}`, "GET", usdValue);
                transactionsUSD.push(getTransactionUSD.body[0]);

                const credit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                    id: generateId(),
                    source: {
                        rail: "lightrail",
                        valueId: usdValue.id
                    },
                    amount: 5,
                    currency: "USD"
                });
                chai.assert.equal(credit.statusCode, 201);
                transactionsUSD.push(credit.body);

                // create CAD initial transaciton
                const cadValue: Partial<Value> = {
                    id: generateId(),
                    currency: "CAD",
                    balance: 25
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", cadValue);
                chai.assert.equal(createValue.statusCode, 201);
                const getTransaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${cadValue.id}`, "GET", cadValue);
                transactionsCAD.push(getTransaction.body[0]);
            }
        });

        it("list transactions", async () => {
            const listTransactions = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions`, "GET");
            chai.assert.equal(listTransactions.body.length, 6);
        });

        it("list USD transactions", async () => {
            const listTransactionsUSD = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?currency=USD`, "GET");
            chai.assert.equal(listTransactionsUSD.body.length, 4);
            chai.assert.sameDeepMembers(listTransactionsUSD.body, transactionsUSD);
        });

        it("list initialBalances: 2 USD, 2 CAD", async () => {
            const listTransactionsInitialBalance = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?transactionType=initialBalance`, "GET");
            chai.assert.equal(listTransactionsInitialBalance.body.length, 4);
            const credits = [...transactionsCAD, ...transactionsUSD.filter(it => it.transactionType === "initialBalance")];
            chai.assert.sameDeepMembers(credits, listTransactionsInitialBalance.body);
        });

        it("list USD initialBalances: 2 USD", async () => {
            const listTransactionsUSDInitialBalances = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?transactionType=initialBalance&currency=USD`, "GET");
            chai.assert.equal(listTransactionsUSDInitialBalances.body.length, 2);
            chai.assert.sameDeepMembers(transactionsUSD.filter(it => it.transactionType === "initialBalance"), listTransactionsUSDInitialBalances.body);
        });

        it("list USD and EUR transactions: 4 USD - 0 EUR", async () => {
            const listTransactionsUSD_EUR = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?currency.in=USD,EUR`, "GET");
            chai.assert.equal(listTransactionsUSD_EUR.body.length, 4);
            chai.assert.sameDeepMembers(transactionsUSD, listTransactionsUSD_EUR.body);
        });

        it("list USD and CAD transactions: 4 USD - 2 CAD", async () => {
            const listTransactionsUSD_CAD = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?currency.in=USD,CAD`, "GET");
            chai.assert.equal(listTransactionsUSD_CAD.body.length, 6);
            chai.assert.sameDeepMembers([...transactionsUSD, ...transactionsCAD], listTransactionsUSD_CAD.body);
        });

        it("list transactions dateCreated < 2088-01-01", async () => {
            const listTransactionsCreatedDate_lt2088 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?createdDate.lt=2088-01-01`, "GET");
            chai.assert.equal(listTransactionsCreatedDate_lt2088.body.length, 6);
            chai.assert.sameDeepMembers([...transactionsUSD, ...transactionsCAD], listTransactionsCreatedDate_lt2088.body);
        });

        it("list transactions dateCreated > 2088-01-01", async () => {
            const listTransactionsCreatedDate_gt2088 = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?createdDate.gt=2088-01-01`, "GET");
            chai.assert.equal(listTransactionsCreatedDate_gt2088.body.length, 0);
        });

        it("list transactions by type and valueId", async () => {
            const listTransactionsByValueIdAndTransactionType = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?transactionType=${transactionsUSD[0].transactionType}&valueId=${transactionsUSD[0].id}`, "GET");
            chai.assert.equal(listTransactionsByValueIdAndTransactionType.body.length, 1);
            chai.assert.deepEqual(listTransactionsByValueIdAndTransactionType.body[0], transactionsUSD[0]);
        });
    });
});

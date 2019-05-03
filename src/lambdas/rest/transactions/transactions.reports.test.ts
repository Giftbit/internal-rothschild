import * as testUtils from "../../../utils/testUtils";
import {createUSD, createUSDCheckout, createUSDValue, generateId, testAuthedRequest} from "../../../utils/testUtils";
import * as chai from "chai";
import * as cassava from "cassava";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Transaction, TransactionForReports} from "../../../model/Transaction";
import {Program} from "../../../model/Program";

describe("transactions reports", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });

        await testUtils.createUSDCheckout(router, null, false);
        await testUtils.createUSDCheckout(router, null, false);
        await testUtils.createUSDCheckout(router, null, false);

        const value = await createUSDValue(router, {balance: 1000});
        const creditResp = await testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: generateId(),
            currency: "USD",
            amount: 500,
            destination: {
                rail: "lightrail",
                valueId: value.id
            }
        });
        chai.assert.equal(creditResp.statusCode, 201, `creditResp.body=${JSON.stringify(creditResp.body)}`);
        const debitResp = await testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: generateId(),
            currency: "USD",
            amount: 550,
            source: {
                rail: "lightrail",
                valueId: value.id
            }
        });
        chai.assert.equal(debitResp.statusCode, 201, `debitResp.body=${JSON.stringify(debitResp.body)}`);
    });

    it("can download a csv of Transactions", async () => {
        const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/transactions/reports", "GET");
        chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.length, 9, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);

        const checkouts = resp.body.filter(txn => txn.transactionType === "checkout");
        chai.assert.equal(checkouts.length, 3, `checkout transactions: ${JSON.stringify(checkouts)}`);
        for (const [index, txn] of checkouts.entries()) {
            chai.assert.deepEqualExcluding(txn, {
                id: "",
                createdDate: null,
                transactionType: "checkout",
                transactionAmount: -1000,
                subtotal: 1000,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 1000,
                paidStripe: 0,
                paidInternal: 0,
                remainder: 0,
                stepsCount: 1,
                sellerNet: null,
                sellerGross: null,
                sellerDiscount: null,
                balanceRule: null,
                redemptionRule: null,
                metadata: null
            }, ["id", "createdDate", "metadata"], `checkout transaction ${index} of ${checkouts.length}: ${JSON.stringify(txn)}`);
        }

        const initialBalances = resp.body.filter(txn => txn.transactionType === "initialBalance");
        chai.assert.equal(initialBalances.length, 4, `initial balance transactions: ${JSON.stringify(initialBalances)}`);
        for (const [index, txn] of initialBalances.entries()) {
            chai.assert.deepEqualExcluding(txn, {
                id: "",
                createdDate: null,
                transactionType: "initialBalance",
                transactionAmount: 1000,
                subtotal: null,
                tax: null,
                discountLightrail: null,
                paidLightrail: null,
                paidStripe: null,
                paidInternal: null,
                remainder: null,
                stepsCount: 1,
                sellerNet: null,
                sellerGross: null,
                sellerDiscount: null,
                balanceRule: null,
                redemptionRule: null,
                metadata: null
            }, ["id", "createdDate", "metadata"], `initialBalance transaction ${index} of ${initialBalances.length}: ${JSON.stringify(txn)}`);
        }
    }).timeout(8000);

    it("limits rows", async () => {
        const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/transactions/reports?limit=1", "GET");
        chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.length, 1, `resp.body=${JSON.stringify(resp.body)}`);
    });

    describe("filtering by transactionType", () => {
        it("can download a csv of checkout Transactions", async () => {
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/transactions/reports?transactionType=checkout", "GET");
            chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.length, 3, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);
            for (const [index, txn] of resp.body.entries()) {
                chai.assert.deepEqualExcluding(txn, {
                    id: "",
                    createdDate: null,
                    transactionType: "checkout",
                    transactionAmount: -1000,
                    subtotal: 1000,
                    tax: 0,
                    discountLightrail: 0,
                    paidLightrail: 1000,
                    paidStripe: 0,
                    paidInternal: 0,
                    remainder: 0,
                    stepsCount: 1,
                    sellerNet: null,
                    sellerGross: null,
                    sellerDiscount: null,
                    balanceRule: null,
                    redemptionRule: null,
                    metadata: null
                }, ["id", "createdDate", "metadata"], `checkout transaction ${index} of ${resp.body.length}: ${JSON.stringify(txn)}`);
            }
        });

        it("can download a csv of initialBalance Transactions", async () => {
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/transactions/reports?transactionType=initialBalance", "GET");
            chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.length, 4, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);
            for (const [index, txn] of resp.body.entries()) {
                chai.assert.deepEqualExcluding(txn, {
                    id: "",
                    createdDate: null,
                    transactionType: "initialBalance",
                    transactionAmount: 1000,
                    subtotal: null,
                    tax: null,
                    discountLightrail: null,
                    paidLightrail: null,
                    paidStripe: null,
                    paidInternal: null,
                    remainder: null,
                    stepsCount: 1,
                    sellerNet: null,
                    sellerGross: null,
                    sellerDiscount: null,
                    balanceRule: null,
                    redemptionRule: null,
                    metadata: null
                }, ["id", "createdDate", "metadata"], `initialBalance transaction ${index} of ${resp.body.length}: ${JSON.stringify(txn)}`);
            }
        });

        it("can download a csv of credit and debit Transactions (two types)", async () => {
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/transactions/reports?transactionType.in=credit,debit", "GET");
            chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.length, 2, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);

            const credit = resp.body.find(txn => txn.transactionType === "credit");
            chai.assert.deepEqualExcluding(credit, {
                id: "",
                createdDate: null,
                transactionType: "credit",
                transactionAmount: 500,
                subtotal: null,
                tax: null,
                discountLightrail: null,
                paidLightrail: null,
                paidStripe: null,
                paidInternal: null,
                remainder: null,
                stepsCount: 1,
                sellerNet: null,
                sellerGross: null,
                sellerDiscount: null,
                balanceRule: null,
                redemptionRule: null,
                metadata: null
            }, ["id", "createdDate", "metadata"], `credit transaction: ${JSON.stringify(credit)}`);

            const debit = resp.body.find(txn => txn.transactionType === "debit");
            chai.assert.deepEqualExcluding(debit, {
                id: "",
                createdDate: null,
                transactionType: "debit",
                transactionAmount: -550,
                subtotal: null,
                tax: null,
                discountLightrail: null,
                paidLightrail: null,
                paidStripe: null,
                paidInternal: null,
                remainder: 0,
                stepsCount: 1,
                sellerNet: null,
                sellerGross: null,
                sellerDiscount: null,
                balanceRule: null,
                redemptionRule: null,
                metadata: null
            }, ["id", "createdDate", "metadata"], `debit transaction: ${JSON.stringify(debit)}`);
        });
    });

    describe("filtering by programId", () => {
        let program1checkout: Transaction;
        let program1debit: Transaction;
        let program2checkout: Transaction;

        before(async () => {
            await createUSD(router);
            const program1resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                id: "program1",
                name: "program1",
                currency: "USD",
                fixedInitialBalances: [5000]
            });
            chai.assert.equal(program1resp.statusCode, 201, `program1resp.body=${JSON.stringify(program1resp.body)}`);
            const program2resp = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", {
                id: "program2",
                name: "program2",
                currency: "USD",
                fixedInitialBalances: [5000]
            });
            chai.assert.equal(program2resp.statusCode, 201, `program1resp.body=${JSON.stringify(program2resp.body)}`);

            const value1 = await createUSDValue(router, {balance: 5000, programId: "program1"});
            const value2 = await createUSDValue(router, {balance: 5000, programId: "program1"});
            const value3 = await createUSDValue(router, {balance: 5000, programId: "program2"});

            program1checkout = (await createUSDCheckout(router, {
                sources: [{
                    rail: "lightrail",
                    valueId: value1.id
                }]
            }, false)).checkout;
            const program1debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: generateId(),
                amount: 200,
                currency: "USD",
                source: {rail: "lightrail", valueId: value2.id}
            });
            chai.assert.equal(program1debitResp.statusCode, 201, `debit3.body=${JSON.stringify(program1debitResp.body)}`);
            program1debit = program1debitResp.body;

            program2checkout = (await createUSDCheckout(router, {
                sources: [{
                    rail: "lightrail",
                    valueId: value3.id
                }]
            }, false)).checkout;
        });

        it("Transactions by programId={id}", async () => {
            const program1report = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, `/v2/transactions/reports?programId=program1`, "GET");
            chai.assert.equal(program1report.statusCode, 200, `program1report.body=${JSON.stringify(program1report.body)}`);
            chai.assert.equal(program1report.body.length, 4, `transaction types in program1report.body: ${program1report.body.map(txn => txn.transactionType)}`);
            chai.assert.equal(program1report.body.find(txn => txn.transactionType === "checkout").id, program1checkout.id, `program1report.body=${JSON.stringify(program1report.body)}`);
            chai.assert.equal(program1report.body.find(txn => txn.transactionType === "debit").id, program1debit.id, `program1report.body=${JSON.stringify(program1report.body)}`);
            chai.assert.equal(program1report.body.filter(txn => txn.transactionType === "initialBalance").length, 2, `program1report.body=${JSON.stringify(program1report.body)}`);
        });

        it("Transactions by programId.eq={id}", async () => {
            const program2report = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, `/v2/transactions/reports?programId.eq=program2`, "GET");
            chai.assert.equal(program2report.statusCode, 200, `program2report.body=${JSON.stringify(program2report.body)}`);
            chai.assert.equal(program2report.body.length, 2, `transaction types in program2report.body: ${program2report.body.map(txn => txn.transactionType)}`);
            chai.assert.equal(program2report.body.find(txn => txn.transactionType === "checkout").id, program2checkout.id, `program2report.body=${JSON.stringify(program2report.body)}`);
            chai.assert.isObject(program2report.body.find(txn => txn.transactionType === "initialBalance"), `program2report.body=${JSON.stringify(program2report.body)}`);
        });

        it("Transactions by programId.in={id,id}", async () => {
            const bothProgramsReport = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, `/v2/transactions/reports?programId.in=program1,program2`, "GET");
            chai.assert.equal(bothProgramsReport.statusCode, 200, `bothProgramsReport.body=${JSON.stringify(bothProgramsReport.body)}`);
            chai.assert.equal(bothProgramsReport.body.length, 6, `transaction types in bothProgramsReport.body: ${bothProgramsReport.body.map(txn => txn.transactionType)}`);
        });
    });

    describe("date range limits", () => {
        it("defaults to most recent month");

        it("can download a csv of Transactions - filtered by month"); // todo one month, or 30days?

        // do we need to test for scenarios where request period is greater than one month? since this is a private endpoint?
    });
});

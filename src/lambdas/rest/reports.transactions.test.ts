import {Transaction, TransactionForReports} from "../../model/Transaction";
import {installRestRoutes} from "./installRestRoutes";
import * as cassava from "cassava";
import * as testUtils from "../../utils/testUtils";
import {Program} from "../../model/Program";
import * as chai from "chai";
import {setStubsForStripeTests, testStripeLive, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";
import {after} from "mocha";


describe("/v2/reports/transactions/", () => {
    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.setCodeCryptographySecrets();
        await testUtils.createUSD(router);

        await testUtils.createUSDCheckout(router, null, false);
        await testUtils.createUSDCheckout(router, null, false);
        await testUtils.createUSDCheckout(router, null, false);

        const value = await testUtils.createUSDValue(router, {balance: 1000});
        const creditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: testUtils.generateId(),
            currency: "USD",
            amount: 500,
            destination: {
                rail: "lightrail",
                valueId: value.id
            }
        });
        chai.assert.equal(creditResp.statusCode, 201, `creditResp.body=${JSON.stringify(creditResp.body)}`);
        const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: testUtils.generateId(),
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
        const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/reports/transactions", "GET");
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
                subtotal: 0,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 0,
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
            }, ["id", "createdDate", "metadata"], `initialBalance transaction ${index} of ${initialBalances.length}: ${JSON.stringify(txn)}`);
        }
    }).timeout(8000);

    describe("row limiting", () => {
        it("limits rows, <10000", async () => {
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/reports/transactions?limit=1", "GET");
            chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.length, 1, `resp.body=${JSON.stringify(resp.body)}`);
        });

        it("errors when requested limit is too high", async () => {
            const resp = await testUtils.testAuthedRequest<TransactionForReports>(router, "/v2/reports/transactions?limit=123456", "GET"); // not testAuthedCsvRequest() because an error is expected which comes back as json
            chai.assert.equal(resp.statusCode, 422, `resp.body=${JSON.stringify(resp.body)}`);
        });
    });

    describe("filtering by transactionType", () => {
        it("can download a csv of checkout Transactions", async () => {
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/reports/transactions?transactionType=checkout", "GET");
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
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/reports/transactions?transactionType=initialBalance", "GET");
            chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.length, 4, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);
            for (const [index, txn] of resp.body.entries()) {
                chai.assert.deepEqualExcluding(txn, {
                    id: "",
                    createdDate: null,
                    transactionType: "initialBalance",
                    transactionAmount: 1000,
                    subtotal: 0,
                    tax: 0,
                    discountLightrail: 0,
                    paidLightrail: 0,
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
                }, ["id", "createdDate", "metadata"], `initialBalance transaction ${index} of ${resp.body.length}: ${JSON.stringify(txn)}`);
            }
        });

        it("can download a csv of credit and debit Transactions (two types)", async () => {
            const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/reports/transactions?transactionType.in=credit,debit", "GET");
            chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.length, 2, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);

            const credit = resp.body.find(txn => txn.transactionType === "credit");
            chai.assert.deepEqualExcluding(credit, {
                id: "",
                createdDate: null,
                transactionType: "credit",
                transactionAmount: 500,
                subtotal: 0,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 0,
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
            }, ["id", "createdDate", "metadata"], `credit transaction: ${JSON.stringify(credit)}`);

            const debit = resp.body.find(txn => txn.transactionType === "debit");
            chai.assert.deepEqualExcluding(debit, {
                id: "",
                createdDate: null,
                transactionType: "debit",
                transactionAmount: -550,
                subtotal: 0,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 0,
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
            }, ["id", "createdDate", "metadata"], `debit transaction: ${JSON.stringify(debit)}`);
        });
    });

    describe("filtering by programId", () => {
        let program1checkout: Transaction;
        let program1debit: Transaction;
        let program2checkout: Transaction;

        before(async () => {
            await testUtils.createUSD(router);
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

            const value1 = await testUtils.createUSDValue(router, {balance: 5000, programId: "program1"});
            const value2 = await testUtils.createUSDValue(router, {balance: 5000, programId: "program1"});
            const value3 = await testUtils.createUSDValue(router, {balance: 5000, programId: "program2"});

            program1checkout = (await testUtils.createUSDCheckout(router, {
                sources: [{
                    rail: "lightrail",
                    valueId: value1.id
                }]
            }, false)).checkout;
            const program1debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: testUtils.generateId(),
                amount: 200,
                currency: "USD",
                source: {rail: "lightrail", valueId: value2.id}
            });
            chai.assert.equal(program1debitResp.statusCode, 201, `debit3.body=${JSON.stringify(program1debitResp.body)}`);
            program1debit = program1debitResp.body;

            program2checkout = (await testUtils.createUSDCheckout(router, {
                sources: [{
                    rail: "lightrail",
                    valueId: value3.id
                }]
            }, false)).checkout;
        });

        it("Transactions by programId={id}", async () => {
            const program1report = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, `/v2/reports/transactions?programId=program1`, "GET");
            chai.assert.equal(program1report.statusCode, 200, `program1report.body=${JSON.stringify(program1report.body)}`);
            chai.assert.equal(program1report.body.length, 4, `transaction types in program1report.body: ${program1report.body.map(txn => txn.transactionType)}`);
            chai.assert.equal(program1report.body.find(txn => txn.transactionType === "checkout").id, program1checkout.id, `program1report.body=${JSON.stringify(program1report.body)}`);
            chai.assert.equal(program1report.body.find(txn => txn.transactionType === "debit").id, program1debit.id, `program1report.body=${JSON.stringify(program1report.body)}`);
            chai.assert.equal(program1report.body.filter(txn => txn.transactionType === "initialBalance").length, 2, `program1report.body=${JSON.stringify(program1report.body)}`);
        });

        it("Transactions by programId.eq={id}", async () => {
            const program2report = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, `/v2/reports/transactions?programId.eq=program2`, "GET");
            chai.assert.equal(program2report.statusCode, 200, `program2report.body=${JSON.stringify(program2report.body)}`);
            chai.assert.equal(program2report.body.length, 2, `transaction types in program2report.body: ${program2report.body.map(txn => txn.transactionType)}`);
            chai.assert.equal(program2report.body.find(txn => txn.transactionType === "checkout").id, program2checkout.id, `program2report.body=${JSON.stringify(program2report.body)}`);
            chai.assert.isObject(program2report.body.find(txn => txn.transactionType === "initialBalance"), `program2report.body=${JSON.stringify(program2report.body)}`);
        });

        it("Transactions by programId.in={id,id}", async () => {
            const bothProgramsReport = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, `/v2/reports/transactions?programId.in=program1,program2`, "GET");
            chai.assert.equal(bothProgramsReport.statusCode, 200, `bothProgramsReport.body=${JSON.stringify(bothProgramsReport.body)}`);
            chai.assert.equal(bothProgramsReport.body.length, 6, `transaction types in bothProgramsReport.body: ${bothProgramsReport.body.map(txn => txn.transactionType)}`);
        });
    });

    describe("multiple transaction steps", () => {
        after(() => {
            unsetStubsForStripeTests();
        });

        it("returns one row per Transaction regardless of number of steps", async () => {
            await testUtils.resetDb();
            await testUtils.createUSD(router);

            const value1 = await testUtils.createUSDValue(router);
            const value2 = await testUtils.createUSDValue(router);
            const transferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
                id: testUtils.generateId(),
                amount: 1,
                currency: "USD",
                source: {
                    rail: "lightrail",
                    valueId: value1.id
                },
                destination: {
                    rail: "lightrail",
                    valueId: value2.id
                }
            });
            chai.assert.equal(transferResp.statusCode, 201, `transferResp.body=${JSON.stringify(transferResp.body)}`);

            const transferReportResp = await testUtils.testAuthedCsvRequest<TransactionForReports[]>(router, "/v2/reports/transactions?transactionType=transfer", "GET");
            chai.assert.equal(transferReportResp.statusCode, 200, `transferReportResp.body=${JSON.stringify(transferReportResp.body)}`);
            chai.assert.deepEqualExcluding(transferReportResp.body[0], {
                id: "",
                transactionType: "transfer",
                createdDate: null,
                transactionAmount: 1,
                subtotal: 0,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 0,
                paidStripe: 0,
                paidInternal: 0,
                remainder: 0,
                stepsCount: 2,
                sellerNet: null,
                sellerDiscount: null,
                sellerGross: null,
                metadata: null,
                balanceRule: null,
                redemptionRule: null
            }, ["createdDate", "id", "metadata"], `transferReportResp.body[0]=${JSON.stringify(transferReportResp.body[0], null, 4)}`);


            const value3 = await testUtils.createUSDValue(router);
            await testUtils.createUSDCheckout(router, {
                lineItems: [{unitPrice: 150}],
                sources: [
                    {
                        rail: "lightrail",
                        valueId: value1.id
                    },
                    {
                        rail: "lightrail",
                        valueId: value2.id
                    },
                    {
                        rail: "lightrail",
                        valueId: value3.id
                    }
                ]
            }, false);

            const checkoutReportResp = await testUtils.testAuthedCsvRequest<TransactionForReports[]>(router, "/v2/reports/transactions?transactionType=checkout", "GET");
            chai.assert.equal(checkoutReportResp.statusCode, 200, `checkoutReportResp.body=${JSON.stringify(checkoutReportResp.body)}`);
            chai.assert.deepEqualExcluding(checkoutReportResp.body[0], {
                id: "",
                transactionType: "checkout",
                createdDate: null,
                transactionAmount: -150,
                subtotal: 150,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 150,
                paidStripe: 0,
                paidInternal: 0,
                remainder: 0,
                stepsCount: 3,
                sellerNet: null,
                sellerDiscount: null,
                sellerGross: null,
                metadata: null,
                balanceRule: null,
                redemptionRule: null
            }, ["createdDate", "id", "metadata"], `checkoutReportResp.body[0]=${JSON.stringify(checkoutReportResp.body[0], null, 4)}`);
        });

        it("handles Stripe steps", async function () {
            if (!testStripeLive()) {
                this.skip();
            }

            await testUtils.resetDb();
            await testUtils.createUSD(router);
            setStubsForStripeTests();

            await testUtils.createUSDCheckout(router, null, true);
            const checkoutReportResp = await testUtils.testAuthedCsvRequest<TransactionForReports[]>(router, "/v2/reports/transactions?transactionType=checkout", "GET");
            chai.assert.equal(checkoutReportResp.statusCode, 200, `checkoutReportResp.body=${JSON.stringify(checkoutReportResp.body)}`);
            chai.assert.deepEqualExcluding(checkoutReportResp.body[0], {
                id: "",
                transactionType: "checkout",
                createdDate: null,
                transactionAmount: -1000,
                subtotal: 1000,
                tax: 0,
                discountLightrail: 0,
                paidLightrail: 50,
                paidStripe: 950,
                paidInternal: 0,
                remainder: 0,
                stepsCount: 2,
                sellerNet: null,
                sellerDiscount: null,
                sellerGross: null,
                metadata: null,
                balanceRule: null,
                redemptionRule: null
            }, ["createdDate", "id", "metadata"], `checkoutReportResp.body=${JSON.stringify(checkoutReportResp.body)}`);
        });
    });
});

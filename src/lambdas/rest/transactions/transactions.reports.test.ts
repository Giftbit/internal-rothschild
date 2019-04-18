import * as testUtils from "../../../utils/testUtils";
import * as chai from "chai";
import * as cassava from "cassava";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {TransactionForReports} from "../../../model/Transaction";

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
    });

    it("can download a csv of Transactions", async () => {
        const resp = await testUtils.testAuthedCsvRequest<TransactionForReports>(router, "/v2/transactions/reports", "GET");
        chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.length, 6, `transactions in resp.body=${resp.body.map(txn => txn.transactionType)}`);

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
        chai.assert.equal(initialBalances.length, 3, `initial balance transactions: ${JSON.stringify(initialBalances)}`);
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

    it("can download a csv of Transactions - filtered by programId");

    it("can download a csv of Transactions - filtered by transactionType");

    describe("date range limits", () => {
        it("defaults to most recent month");

        it("can download a csv of Transactions - filtered by month"); // todo one month, or 30days?

        // do we need to test for scenarios where request period is greater than one month? since this is a private endpoint?
    });

    describe.skip("limits results to 10,000 rows", () => {
        it("succeeds when the query result is fewer than 10,000");

        it("errors when the query result is more than 10,000");
    });
});

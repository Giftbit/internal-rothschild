import * as chai from "chai";
import {TransactionPlanError} from "./TransactionPlanError";
import * as testUtils from "../../../testUtils";
import {DbValue} from "../../../model/Value";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexWrite} from "../../../dbUtils";
import {TransactionPlan} from "./TransactionPlan";
import {executeTransactionPlan} from "./executeTransactionPlan";
import {DbCurrency} from "../../../model/Currency";

describe("rest/transactions/executeTransactionPlan", () => {

    before(async function () {
        await testUtils.resetDb();
    });

    const auth = new giftbitRoutes.jwtauth.AuthorizationBadge({
        g: {
            gui: "user",
            gmi: "user"
        }
    });

    it("throws a replannable TransactionPlanError when there is not enough value", async () => {
        const currency: DbCurrency = {
            userId: "user",
            code: "CAD",
            name: "Monopoly money",
            symbol: "$",
            decimalPlaces: 2
        };

        const value: DbValue = {
            userId: "user",
            id: "vs-1",
            currency: "CAD",
            uses: null,
            code: null,
            codeLastFour: null,
            codeHashed: null,
            contact: null,
            balance: 1500,
            pretax: false,
            active: true,
            expired: false,
            frozen: false,
            redemptionRule: "null",
            valueRule: "null",
            startDate: null,
            endDate: null,
            metadata: "null",
            createdDate: new Date(),
            updatedDate: new Date()
        };

        const knex = await getKnexWrite();
        await knex("Currencies").insert(currency);
        await knex("ValueStores").insert(value);

        const plan: TransactionPlan = {
            transactionId: "xxx",
            transactionType: "debit",
            steps: [
                {
                    rail: "lightrail",
                    valueStore: DbValue.toValue(value),
                    codeLastFour: null,
                    customerId: null,
                    amount: -3500    // more than is in the value
                }
            ],
            remainder: 0
        };

        let err: TransactionPlanError;
        try {
            await executeTransactionPlan(auth, plan);
        } catch (e) {
            err = e;
        }

        chai.assert.isDefined(err, "executeTransactionPlan threw an error");
        chai.assert.isTrue(err.isTransactionPlanError, "isTransactionPlanError");
        chai.assert.isTrue(err.isReplanable, "isReplanable");

        const transactionsRes: any[] = await knex("Transactions")
            .where({
                userId: auth.giftbitUserId,
                transactionId: plan.transactionId
            });
        chai.assert.lengthOf(transactionsRes, 0);
    });

    it("throws a replannable TransactionPlanError when there are 0 uses", async () => {
        const value: DbValue = {
            userId: "user",
            id: "vs-2",
            currency: "CAD",
            balance: 1500,
            uses: 0,
            code: null,
            codeLastFour: null,
            codeHashed: null,
            contact: null,
            pretax: false,
            active: true,
            expired: false,
            frozen: false,
            redemptionRule: "null",
            valueRule: "null",
            startDate: null,
            endDate: null,
            metadata: "null",
            createdDate: new Date(),
            updatedDate: new Date()
        };

        const knex = await getKnexWrite();
        await knex("ValueStores").insert(value);

        const plan: TransactionPlan = {
            transactionId: "xxx",
            transactionType: "credit",
            steps: [
                {
                    rail: "lightrail",
                    valueStore: DbValue.toValue(value),
                    codeLastFour: null,
                    customerId: null,
                    amount: 1200
                }
            ],
            remainder: null
        };

        let err: TransactionPlanError;
        try {
            await executeTransactionPlan(auth, plan);
        } catch (e) {
            err = e;
        }

        chai.assert.isDefined(err, "executeTransactionPlan threw an error");
        chai.assert.isTrue(err.isTransactionPlanError, "isTransactionPlanError");
        chai.assert.isTrue(err.isReplanable, "isReplanable");

        const transactionsRes: any[] = await knex("Transactions")
            .where({
                userId: auth.giftbitUserId,
                transactionId: plan.transactionId
            });
        chai.assert.lengthOf(transactionsRes, 0);
    });
});

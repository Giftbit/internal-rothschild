import * as chai from "chai";
import {TransactionPlanError} from "./TransactionPlanError";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser} from "../../../utils/testUtils";
import {DbValue} from "../../../model/Value";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {TransactionPlan} from "./TransactionPlan";
import {executeTransactionPlan} from "./executeTransactionPlan";
import {DbCurrency} from "../../../model/Currency";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
import {nowInDbPrecision} from "../../../utils/dbUtils";

describe("rest/transactions/executeTransactionPlan", () => {

    before(async function () {
        await testUtils.resetDb();
    });

    const auth = new giftbitRoutes.jwtauth.AuthorizationBadge({
        g: {
            gui: "user",
            gmi: "user",
            tmi: "user"
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
            id: "v-1",
            currency: "CAD",
            usesRemaining: null,
            programId: null,
            issuanceId: null,
            codeLastFour: null,
            isGenericCode: false,
            codeEncrypted: null,
            codeHashed: null,
            contactId: null,
            balance: 1500,
            pretax: false,
            active: true,
            canceled: false,
            frozen: false,
            redemptionRule: "null",
            balanceRule: "null",
            discount: false,
            discountSellerLiability: null,
            startDate: null,
            endDate: null,
            metadata: "null",
            createdDate: new Date(),
            updatedDate: new Date(),
            updatedContactIdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        };

        const knex = await getKnexWrite();
        await knex("Currencies").insert(currency);
        await knex("Values").insert(value);

        const plan: TransactionPlan = {
            id: "xxx",
            transactionType: "debit",
            currency: "CAD",
            steps: [
                {
                    rail: "lightrail",
                    value: DbValue.toValue(value),
                    amount: -3500,    // more than is in the value
                    uses: null,
                    knownTransactable: true
                }
            ],
            totals: {remainder: 0},
            lineItems: null,
            paymentSources: null,
            createdDate: nowInDbPrecision(),
            metadata: null,
            tax: null
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
                userId: auth.userId,
                id: plan.id
            });
        chai.assert.lengthOf(transactionsRes, 0);
    });

    it("throws a replannable TransactionPlanError when there are 0 usesRemaining", async () => {
        const value: DbValue = {
            userId: "user",
            id: "v-2",
            currency: "CAD",
            balance: 1500,
            usesRemaining: 0,
            programId: null,
            issuanceId: null,
            codeLastFour: null,
            isGenericCode: false,
            codeEncrypted: null,
            codeHashed: null,
            contactId: null,
            pretax: false,
            active: true,
            canceled: false,
            frozen: false,
            redemptionRule: "null",
            balanceRule: "null",
            discount: false,
            discountSellerLiability: null,
            startDate: null,
            endDate: null,
            metadata: "null",
            createdDate: new Date(),
            updatedDate: new Date(),
            updatedContactIdDate: null,
            createdBy: defaultTestUser.auth.userId
            // createdBy: defaultTestUser.auth.teamMemberId  // require tmi again
        };

        const knex = await getKnexWrite();
        await knex("Values").insert(value);

        const plan: TransactionPlan = {
            id: "xxx",
            transactionType: "debit",
            currency: "CAD",
            steps: [
                {
                    rail: "lightrail",
                    value: DbValue.toValue(value),
                    amount: -1200,
                    uses: -1,
                    knownTransactable: true
                }
            ],
            totals: {remainder: null},
            lineItems: null,
            paymentSources: null,
            createdDate: nowInDbPrecision(),
            metadata: null,
            tax: null,
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
                userId: auth.userId,
                id: plan.id
            });
        chai.assert.lengthOf(transactionsRes, 0);
    });
});

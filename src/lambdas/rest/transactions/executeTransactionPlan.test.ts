import * as chai from "chai";
import {TransactionPlanError} from "./TransactionPlanError";
import * as testUtils from "../../../testUtils";
import {DbValueStore, ValueStore} from "../../../model/ValueStore";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexWrite} from "../../../dbUtils";
import {TransactionPlan} from "./TransactionPlan";
import {executeTransactionPlan} from "./executeTransactionPlan";

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
        const valueStore: DbValueStore = {
            userId: "user",
            valueStoreId: "vs-1",
            valueStoreType: "GIFTCARD",
            currency: "CAD",
            value: 1500,
            pretax: false,
            active: true,
            expired: false,
            frozen: false,
            redemptionRule: "null",
            valueRule: "null",
            uses: null,
            startDate: null,
            endDate: null,
            metadata: "null",
            createdDate: new Date(),
            updatedDate: new Date()
        };

        const knex = await getKnexWrite();
        await knex("ValueStores").insert(valueStore);

        const plan: TransactionPlan = {
            transactionId: "xxx",
            transactionType: "debit",
            steps: [
                {
                    rail: "lightrail",
                    valueStore: DbValueStore.toValueStore(valueStore),
                    codeLastFour: null,
                    customerId: null,
                    amount: -3500    // more than is in the value store
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
    });

    it("throws a replannable TransactionPlanError when there are 0 uses", async () => {
        const valueStore: DbValueStore = {
            userId: "user",
            valueStoreId: "vs-2",
            valueStoreType: "GIFTCARD",
            currency: "CAD",
            value: 1500,
            pretax: false,
            active: true,
            expired: false,
            frozen: false,
            redemptionRule: "null",
            valueRule: "null",
            uses: 0,
            startDate: null,
            endDate: null,
            metadata: "null",
            createdDate: new Date(),
            updatedDate: new Date()
        };

        const knex = await getKnexWrite();
        await knex("ValueStores").insert(valueStore);

        const plan: TransactionPlan = {
            transactionId: "xxx",
            transactionType: "credit",
            steps: [
                {
                    rail: "lightrail",
                    valueStore: DbValueStore.toValueStore(valueStore),
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
    });
});

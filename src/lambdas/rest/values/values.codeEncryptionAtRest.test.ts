import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets} from "../../../utils/testUtils/index";
import {DbValue, Value} from "../../../model/Value";
import {DbTransaction, LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import * as sinon from "sinon";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import * as codeGenerator from "../../../utils/codeGenerator";
import {CheckoutRequest, LightrailTransactionParty} from "../../../model/TransactionRequest";
import chaiExclude from "chai-exclude";
import {nowInDbPrecision} from "../../../utils/dbUtils";

chai.use(chaiExclude);

describe("/v2/values/", () => {

    const router = new cassava.Router();
    const sinonSandbox = sinon.createSandbox();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision(),
            createdBy: testUtils.defaultTestUser.teamMemberId
        });
    });

    after(async () => {
        sinonSandbox.restore();
    });

    describe("code encryption at rest tests", () => {
        const value = {
            id: generateId(),
            currency: "USD",
            generateCode: {},
            balance: 10
        };
        const fullcode = "QWERASDFZXCV";

        it("create value", async () => {
            const knex = await getKnexRead();
            const generateCodeStub = sinonSandbox.stub(codeGenerator, "generateCode");
            generateCodeStub.returns(fullcode);

            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.body.code, "…ZXCV");
            chai.assert.notInclude(JSON.stringify(createValue.body), fullcode);
            let valueQuery = knex("Values")
                .select("*")
                .where({
                    "userId": testUtils.defaultTestUser.userId,
                    "id": value.id
                });
            const dbValuesRes: DbValue[] = await valueQuery;
            chai.assert.equal(dbValuesRes[0].codeLastFour, "ZXCV");
            chai.assert.notInclude(JSON.stringify(dbValuesRes), fullcode);
            generateCodeStub.restore();
        });

        it("initialBalance transaction", async () => {
            const knex = await getKnexRead();

            const getTransaction = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${value.id}`, "GET");
            chai.assert.equal((getTransaction.body[0].steps[0] as LightrailTransactionStep).code, "…ZXCV");
            chai.assert.notInclude(JSON.stringify(getTransaction.body), fullcode);
            let transactionQuery = knex("Transactions")
                .select("*")
                .where({
                    "userId": testUtils.defaultTestUser.userId,
                    "id": value.id
                });
            const dbTrx: DbTransaction[] = await transactionQuery;
            chai.assert.notInclude(JSON.stringify(dbTrx), fullcode);

            let stepQuery = knex("LightrailTransactionSteps")
                .select("*")
                .where({
                    "userId": testUtils.defaultTestUser.userId,
                    "transactionId": value.id
                });
            const dbStep: LightrailTransactionStep[] = await stepQuery;
            chai.assert.equal(dbStep[0].code, "…ZXCV");
            chai.assert.notInclude(JSON.stringify(dbStep), fullcode);
        });

        it("checkout transaction", async () => {
            const knex = await getKnexRead();

            const checkout: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {
                        rail: "lightrail",
                        code: fullcode
                    }
                ],
                lineItems: [
                    {
                        unitPrice: 1
                    }
                ]
            };
            const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/checkout`, "POST", checkout);
            chai.assert.equal((createCheckout.body.paymentSources[0] as LightrailTransactionParty).code, "…ZXCV");
            chai.assert.equal((createCheckout.body.steps[0] as LightrailTransactionStep).code, "…ZXCV");
            chai.assert.notInclude(JSON.stringify(createCheckout), fullcode);

            let transactionQuery = knex("Transactions")
                .select("*")
                .where({
                    "userId": testUtils.defaultTestUser.userId,
                    "id": checkout.id
                });
            const dbTrx: DbTransaction[] = await transactionQuery;
            chai.assert.notInclude(JSON.stringify(dbTrx), fullcode);

            let stepQuery = knex("LightrailTransactionSteps")
                .select("*")
                .where({
                    "userId": testUtils.defaultTestUser.userId,
                    "transactionId": checkout.id
                });
            const dbStep: LightrailTransactionStep[] = await stepQuery;
            chai.assert.equal(dbStep[0].code, "…ZXCV");
            chai.assert.notInclude(JSON.stringify(dbStep), fullcode);
        });
    });
});

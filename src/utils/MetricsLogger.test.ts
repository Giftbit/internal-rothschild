import {MetricsLogger, valueAttachmentTypes} from "./metricsLogger";
import * as testUtils from "./testUtils";
import {defaultTestUser, generateId} from "./testUtils";
import * as cassava from "cassava";
import {installRestRoutes} from "../lambdas/rest/installRestRoutes";
import sinon from "sinon";
import * as chai from "chai";
import {Value} from "../model/Value";
import {createCurrency} from "../lambdas/rest/currencies";
import {Contact} from "../model/Contact";
import {Transaction, TransactionType} from "../model/Transaction";
import {TransactionPlan} from "../lambdas/rest/transactions/TransactionPlan";
import {CheckoutRequest} from "../model/TransactionRequest";
import log = require("loglevel");

describe("MetricsLogger", () => {

    let sandbox: sinon.SinonSandbox;

    const router = new cassava.Router();
    const contactPartial: Partial<Contact> = {
        id: "12345",
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });
        await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactPartial);
    });

    beforeEach(function () {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });


    describe("valueAttachment", () => {

        function getValueAttachmentLog(attachType: valueAttachmentTypes): RegExp {
            return new RegExp("MONITORING\\|\\d{10}\\|1\\|histogram\\|rothschild\\.values\\.attach\\." + attachType + "\\|#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
        }

        it("generates correct log statement when called directly", () => {
            const spy = sandbox.spy(log, "info");

            MetricsLogger.valueAttachment(valueAttachmentTypes.onCreate, defaultTestUser.auth);
            chai.assert.match(spy.args[0][0], getValueAttachmentLog(valueAttachmentTypes.onCreate));

            MetricsLogger.valueAttachment(valueAttachmentTypes.unique, defaultTestUser.auth);
            chai.assert.match(spy.args[1][0], getValueAttachmentLog(valueAttachmentTypes.unique));

            MetricsLogger.valueAttachment(valueAttachmentTypes.generic, defaultTestUser.auth);
            chai.assert.match(spy.args[2][0], getValueAttachmentLog(valueAttachmentTypes.generic));

            MetricsLogger.valueAttachment(valueAttachmentTypes.genericAsNew, defaultTestUser.auth);
            chai.assert.match(spy.args[3][0], getValueAttachmentLog(valueAttachmentTypes.genericAsNew));
        });

        describe("integration tests", () => {
            it("'onCreate' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "1",
                    currency: "USD",
                    balance: 0,
                    contactId: "12345"
                });
                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLog(valueAttachmentTypes.onCreate)));
            });

            it("'unique' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "1",
                    currency: "USD",
                    balance: 0,
                });
                await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {valueId: "1"});

                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLog(valueAttachmentTypes.unique)));
            });

            it("'generic' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "2",
                    currency: "USD",
                    balance: 0,
                    isGenericCode: true
                });
                await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {valueId: "2"});
                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLog(valueAttachmentTypes.generic)));
            });

            it("'genericAsNew' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "2",
                    currency: "USD",
                    balance: 0,
                    isGenericCode: true
                });
                await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {
                    valueId: "2",
                    attachGenericAsNewValue: true
                });
                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLog(valueAttachmentTypes.genericAsNew)));
            });
        });
    });

    describe("Transactions metrics", () => {

        function getTransactionLog(transactionType: TransactionType): RegExp {
            return new RegExp("MONITORING\\|\\d{10}\\|1\\|histogram\\|rothschild\\.transactions\\|#type:" + transactionType + ",#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
        }

        it("generates correct log statement - called directly", () => {
            const spy = sandbox.spy(log, "info");

            function getTransactionPlan(type: TransactionType): TransactionPlan {
                return {
                    id: generateId(),
                    transactionType: type,
                    currency: "USD",
                    totals: null,
                    lineItems: null,
                    paymentSources: null,
                    steps: null,
                    tax: null,
                    createdDate: new Date(),
                    metadata: null
                };
            }

            MetricsLogger.transaction(getTransactionPlan("checkout"), defaultTestUser.auth);
            chai.assert.match(spy.args[0][0], getTransactionLog("checkout"));

            MetricsLogger.transaction(getTransactionPlan("credit"), defaultTestUser.auth);
            chai.assert.match(spy.args[1][0], getTransactionLog("credit"));

            MetricsLogger.transaction(getTransactionPlan("debit"), defaultTestUser.auth);
            chai.assert.match(spy.args[2][0], getTransactionLog("debit"));

            MetricsLogger.transaction(getTransactionPlan("transfer"), defaultTestUser.auth);
            chai.assert.match(spy.args[3][0], getTransactionLog("transfer"));

            MetricsLogger.transaction(getTransactionPlan("initialBalance"), defaultTestUser.auth);
            chai.assert.match(spy.args[4][0], getTransactionLog("initialBalance"));

            MetricsLogger.transaction(getTransactionPlan("reverse"), defaultTestUser.auth);
            chai.assert.match(spy.args[5][0], getTransactionLog("reverse"));

            MetricsLogger.transaction(getTransactionPlan("capture"), defaultTestUser.auth);
            chai.assert.match(spy.args[6][0], getTransactionLog("capture"));

            MetricsLogger.transaction(getTransactionPlan("void"), defaultTestUser.auth);
            chai.assert.match(spy.args[7][0], getTransactionLog("void"));

            MetricsLogger.transaction(getTransactionPlan("attach"), defaultTestUser.auth);
            chai.assert.match(spy.args[8][0], getTransactionLog("attach"));
        });

        describe("integration tests", () => {
            it("generates correct log for checkout transaction", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "3",
                    currency: "USD",
                    balance: 100000
                });
                const request: CheckoutRequest = {
                    id: generateId(),
                    sources: [
                        {
                            rail: "lightrail",
                            valueId: "3"
                        }
                    ],
                    lineItems: [
                        {
                            type: "product",
                            productId: "xyz-123",
                            unitPrice: 123
                        }
                    ],
                    currency: "USD"
                };

                await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
                sinon.assert.calledWith(spy, sinon.match(getTransactionLog("checkout")));
            });
        });
    });
});
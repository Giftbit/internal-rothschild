import * as cassava from "cassava";
import * as chai from "chai";
import sinon from "sinon";
import * as testUtils from "./testUtils";
import {defaultTestUser, generateId} from "./testUtils";
import {MetricsLogger, ValueAttachmentTypes} from "./metricsLogger";
import {installRestRoutes} from "../lambdas/rest/installRestRoutes";
import {Value} from "../model/Value";
import {Contact} from "../model/Contact";
import {Transaction, TransactionType} from "../model/Transaction";
import {StripeChargeTransactionPlanStep, TransactionPlan} from "../lambdas/rest/transactions/TransactionPlan";
import {CheckoutRequest} from "../model/TransactionRequest";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "./testUtils/stripeTestUtils";
import {Currency} from "../model/Currency";
import log = require("loglevel");

describe("MetricsLogger", () => {

    let sandbox: sinon.SinonSandbox;

    const router = new cassava.Router();
    const contactPartial: Partial<Contact> = {
        id: generateId(),
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        const currencyResp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });
        chai.assert.equal(currencyResp.statusCode, 201, `body=${JSON.stringify(currencyResp.body)}`);

        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactPartial);
        chai.assert.equal(contactResp.statusCode, 201, `body=${JSON.stringify(contactResp.body)}`);
    });

    beforeEach(function () {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe("valueAttachment", () => {

        function getValueAttachmentLogMatcher(attachType: ValueAttachmentTypes): RegExp {
            return new RegExp("MONITORING\\|\\d{10}\\|1\\|histogram\\|rothschild\\.values\\.attach\\|#type:" + attachType + ",#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
        }

        it("generates correct log statement when called directly", () => {
            const spy = sandbox.spy(log, "info");

            MetricsLogger.valueAttachment(ValueAttachmentTypes.OnCreate, defaultTestUser.auth);
            chai.assert.match(spy.args[0][0], getValueAttachmentLogMatcher(ValueAttachmentTypes.OnCreate));

            MetricsLogger.valueAttachment(ValueAttachmentTypes.Unique, defaultTestUser.auth);
            chai.assert.match(spy.args[1][0], getValueAttachmentLogMatcher(ValueAttachmentTypes.Unique));

            MetricsLogger.valueAttachment(ValueAttachmentTypes.Generic, defaultTestUser.auth);
            chai.assert.match(spy.args[2][0], getValueAttachmentLogMatcher(ValueAttachmentTypes.Generic));

            MetricsLogger.valueAttachment(ValueAttachmentTypes.GenericAsNew, defaultTestUser.auth);
            chai.assert.match(spy.args[3][0], getValueAttachmentLogMatcher(ValueAttachmentTypes.GenericAsNew));
        });

        describe("integration tests", () => {
            it("'OnCreate' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 0,
                    contactId: contactPartial.id
                };
                const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.OnCreate)));
            });

            it("'Unique' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");

                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 0,
                    contactId: contactPartial.id
                };
                const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

                const attachValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attachValueResp.statusCode, 200, `body=${JSON.stringify(attachValueResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.Unique)));
            });

            it("'Generic' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 0,
                    isGenericCode: true
                };
                const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

                const attachValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attachValueResp.statusCode, 200, `body=${JSON.stringify(attachValueResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.Generic)));
            });

            it("'GenericAsNew' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");

                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 0,
                    isGenericCode: true
                };
                const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

                const attachValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {
                    valueId: value.id,
                    attachGenericAsNewValue: true
                });
                chai.assert.equal(attachValueResp.statusCode, 200, `body=${JSON.stringify(attachValueResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.GenericAsNew)));
            });
        });
    });

    describe("Transactions metrics", () => {

        function getTransactionLogMatcher(transactionType: TransactionType): RegExp {
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
            chai.assert.match(spy.args[0][0], getTransactionLogMatcher("checkout"));

            MetricsLogger.transaction(getTransactionPlan("credit"), defaultTestUser.auth);
            chai.assert.match(spy.args[1][0], getTransactionLogMatcher("credit"));

            MetricsLogger.transaction(getTransactionPlan("debit"), defaultTestUser.auth);
            chai.assert.match(spy.args[2][0], getTransactionLogMatcher("debit"));

            MetricsLogger.transaction(getTransactionPlan("transfer"), defaultTestUser.auth);
            chai.assert.match(spy.args[3][0], getTransactionLogMatcher("transfer"));

            MetricsLogger.transaction(getTransactionPlan("initialBalance"), defaultTestUser.auth);
            chai.assert.match(spy.args[4][0], getTransactionLogMatcher("initialBalance"));

            MetricsLogger.transaction(getTransactionPlan("reverse"), defaultTestUser.auth);
            chai.assert.match(spy.args[5][0], getTransactionLogMatcher("reverse"));

            MetricsLogger.transaction(getTransactionPlan("capture"), defaultTestUser.auth);
            chai.assert.match(spy.args[6][0], getTransactionLogMatcher("capture"));

            MetricsLogger.transaction(getTransactionPlan("void"), defaultTestUser.auth);
            chai.assert.match(spy.args[7][0], getTransactionLogMatcher("void"));

            MetricsLogger.transaction(getTransactionPlan("attach"), defaultTestUser.auth);
            chai.assert.match(spy.args[8][0], getTransactionLogMatcher("attach"));
        });

        describe("integration tests", () => {
            it("generates correct log for checkout transaction", async () => {
                const spy = sandbox.spy(log, "info");
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: "USD",
                    balance: 100000
                };
                const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

                const request: CheckoutRequest = {
                    id: generateId(),
                    sources: [
                        {
                            rail: "lightrail",
                            valueId: value.id
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

                const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
                chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getTransactionLogMatcher("checkout")));
            });
        });
    });

    describe("Stripe metrics", () => {
        function getStripeCallLogMatcher(stepAmount: number, stripeCallType: string): RegExp {
            return new RegExp("MONITORING\\|\\d{10}\\|" + stepAmount + "\\|histogram\\|rothschild\\.transactions\\.stripe\\.calls\\|#type:" + stripeCallType + ",#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
        }

        function getStripeErrorLogMatcher(stripeErrorType: string): RegExp {
            return new RegExp("MONITORING\\|\\d{10}\\|1\\|histogram\\|rothschild\\.transactions\\.stripe\\.errors\\|#stripeErrorType:" + stripeErrorType + ",#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
        }

        describe("direct calls", () => {
            it("generates correct log statement - called directly - stripe call", () => {
                const spy = sandbox.spy(log, "info");
                const stripeStep: StripeChargeTransactionPlanStep = {
                    rail: "stripe",
                    type: "charge",
                    stepIdempotencyKey: "",
                    amount: 0,
                    minAmount: null,
                    maxAmount: null,
                    forgiveSubMinAmount: null,
                    additionalStripeParams: {}
                };

                MetricsLogger.stripeCall(stripeStep, defaultTestUser.auth);
                chai.assert.match(spy.args[0][0], getStripeCallLogMatcher(stripeStep.amount, "charge"));
            });

            it("generates correct log statement - called directly - error", () => {
                const spy = sandbox.spy(log, "info");

                MetricsLogger.stripeError({type: "card_error"}, defaultTestUser.auth);
                chai.assert.match(spy.args[0][0], getStripeErrorLogMatcher("card_error"));
            });
        });

        describe("integration tests", () => {
            before(async function () {
                await setStubsForStripeTests();
            });

            after(() => {
                unsetStubsForStripeTests();
            });

            const amount = 5000;
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                sources: [
                    {
                        rail: "stripe",
                        source: "tok_visa"
                    }
                ],
                lineItems: [
                    {
                        type: "product",
                        productId: "xyz-123",
                        unitPrice: amount
                    }
                ],
                currency: "USD"
            };

            it("generates correct log statement for Stripe charge & refund", async () => {
                const spy = sandbox.spy(log, "info");

                const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);
                sinon.assert.calledWith(spy, sinon.match(getStripeCallLogMatcher(-amount, "charge")));

                const refundResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: `reverse-${checkoutRequest.id}`});
                chai.assert.equal(refundResp.statusCode, 201, `body=${JSON.stringify(refundResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getStripeCallLogMatcher(amount, "refund")));
            });

            it("generates correct log statement for Stripe capture", async () => {
                const spy = sandbox.spy(log, "info");
                const pendingCheckoutRequest: CheckoutRequest = {...checkoutRequest, id: generateId(), pending: true};

                const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/checkout`, "POST", pendingCheckoutRequest);
                chai.assert.equal(checkoutResp.statusCode, 201, `body=${JSON.stringify(checkoutResp.body)}`);

                const captureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingCheckoutRequest.id}/capture`, "POST", {id: `capture-${pendingCheckoutRequest.id}`});
                chai.assert.equal(captureResp.statusCode, 201, `body=${JSON.stringify(captureResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getStripeCallLogMatcher(0, "capture")));
            });

            it("generates correct log statement for Stripe error", async () => {
                const spy = sandbox.spy(log, "info");
                const errorCheckoutReq: CheckoutRequest = {
                    ...checkoutRequest,
                    id: generateId(),
                    sources: [{rail: "stripe", source: "tok_chargeDeclined"}]
                };

                const errorResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", errorCheckoutReq);
                chai.assert.equal(errorResp.statusCode, 409, `body=${JSON.stringify(errorResp.body)}`);

                sinon.assert.calledWith(spy, sinon.match(getStripeErrorLogMatcher("StripeCardError")));
            });
        });
    });
});

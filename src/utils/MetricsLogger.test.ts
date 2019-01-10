import {MetricsLogger, ValueAttachmentTypes} from "./metricsLogger";
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
import {StripeTransactionPlanStep, TransactionPlan} from "../lambdas/rest/transactions/TransactionPlan";
import {CheckoutRequest} from "../model/TransactionRequest";
import {
    setStubsForStripeTests,
    stubCheckoutStripeCharge,
    stubCheckoutStripeError,
    stubStripeCapture,
    stubStripeRefund,
    unsetStubsForStripeTests
} from "./testUtils/stripeTestUtils";
import {after} from "mocha";
import {StripeRestError} from "./stripeUtils/StripeRestError";
import log = require("loglevel");

require("dotenv").config();


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

        function getValueAttachmentLogMatcher(attachType: ValueAttachmentTypes): RegExp {
            return new RegExp("MONITORING\\|\\d{10}\\|1\\|histogram\\|rothschild\\.values\\.attach\\." + attachType + "\\|#userId:default-test-user-TEST,#teamMemberId:default-test-user-TEST,#liveMode:false");
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
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "1",
                    currency: "USD",
                    balance: 0,
                    contactId: "12345"
                });
                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.OnCreate)));
            });

            it("'Unique' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "1",
                    currency: "USD",
                    balance: 0,
                });
                await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {valueId: "1"});

                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.Unique)));
            });

            it("'Generic' generates correct log statement", async () => {
                const spy = sandbox.spy(log, "info");
                await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                    id: "2",
                    currency: "USD",
                    balance: 0,
                    isGenericCode: true
                });
                await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactPartial.id}/values/attach`, "POST", {valueId: "2"});
                sinon.assert.calledWith(spy, sinon.match(getValueAttachmentLogMatcher(ValueAttachmentTypes.Generic)));
            });

            it("'GenericAsNew' generates correct log statement", async () => {
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
                const stripeStep = {
                    rail: "stripe",
                    type: "charge",
                    idempotentStepId: "",
                    maxAmount: null,
                    amount: 0
                };

                MetricsLogger.stripeCall(stripeStep as StripeTransactionPlanStep, defaultTestUser.auth);
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
                setStubsForStripeTests();
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

                const [stripeResponse] = stubCheckoutStripeCharge(checkoutRequest, 0, 5000);

                await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
                sinon.assert.calledWith(spy, sinon.match(getStripeCallLogMatcher(-amount, "charge")));

                stubStripeRefund(stripeResponse);
                await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutRequest.id}/reverse`, "POST", {id: `reverse-${checkoutRequest.id}`});

                sinon.assert.calledWith(spy, sinon.match(getStripeCallLogMatcher(amount, "refund")));
            });

            it("generates correct log statement for Stripe capture", async () => {
                const spy = sandbox.spy(log, "info");
                const pendingCheckoutRequest: CheckoutRequest = {...checkoutRequest, id: generateId(), pending: true};

                const [stripePending] = stubCheckoutStripeCharge(pendingCheckoutRequest, 0, 5000);
                await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/checkout`, "POST", pendingCheckoutRequest);

                stubStripeCapture(stripePending);
                await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingCheckoutRequest.id}/capture`, "POST", {id: `capture-${pendingCheckoutRequest.id}`});

                sinon.assert.calledWith(spy, sinon.match(getStripeCallLogMatcher(0, "capture")));
            });

            it("generates correct log statement for Stripe error", async () => {
                const spy = sandbox.spy(log, "info");
                const errorCheckoutReq: CheckoutRequest = {
                    ...checkoutRequest,
                    id: generateId(),
                    sources: [{rail: "stripe", source: "tok_chargeDeclined"}]
                };

                stubCheckoutStripeError(errorCheckoutReq, 0, new StripeRestError(400, "", "", {type: "StripeCardError"}));
                await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", errorCheckoutReq);

                sinon.assert.calledWith(spy, sinon.match(getStripeErrorLogMatcher("StripeCardError")));
            });
        });
    });
});
import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values/values";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../../utils/testUtils";
import {Value} from "../../../../model/Value";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import {CaptureRequest, CheckoutRequest, VoidRequest} from "../../../../model/TransactionRequest";
import {
    setStubsForStripeTests,
    stripeLiveMerchantConfig,
    unsetStubsForStripeTests
} from "../../../../utils/testUtils/stripeTestUtils";
import {after} from "mocha";
import * as Stripe from "stripe";
import {captureCharge, createRefund} from "../../../../utils/stripeUtils/stripeTransactions";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/checkout - pending", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Tire Money",
            symbol: "$",
            decimalPlaces: 2
        });
        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("can create and void a pending transaction, Lightrail only", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000,
        };
        const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

        const pendingTx: CheckoutRequest = {
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
                    productId: "🍌",
                    unitPrice: 50
                }
            ],
            currency: "CAD",
            pending: true
        };
        const pendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pendingTx);
        chai.assert.equal(pendingTxRes.statusCode, 201, `body=${JSON.stringify(pendingTxRes.body)}`);
        chai.assert.deepEqualExcluding(pendingTxRes.body, {
            id: pendingTx.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                subtotal: 50,
                tax: 0,
                discount: 0,
                discountLightrail: 0,
                payable: 50,
                paidInternal: 0,
                paidLightrail: 50,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
            },
            lineItems: [
                {
                    type: "product",
                    productId: "🍌",
                    unitPrice: 50,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 50,
                        taxable: 50,
                        tax: 0,
                        discount: 0,
                        payable: 50,
                        remainder: 0
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 950,
                    balanceChange: -50,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            paymentSources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            pending: true,
            pendingVoidDate: null,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "pendingVoidDate"]);
        chai.assert.isNotNull(pendingTxRes.body.pendingVoidDate);

        const getPendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}`, "GET");
        chai.assert.equal(getPendingTxRes.statusCode, 200, `body=${JSON.stringify(getPendingTxRes.body)}`);
        chai.assert.deepEqual(getPendingTxRes.body, pendingTxRes.body);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 950);

        const voidTx: VoidRequest = {
            id: generateId()
        };
        const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/void`, "POST", voidTx);
        chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
        chai.assert.deepEqualExcluding(voidRes.body, {
            id: voidTx.id,
            transactionType: "void",
            currency: "CAD",
            totals: {
                subtotal: -50,
                tax: 0,
                discount: 0,
                discountLightrail: 0,
                payable: -50,
                paidInternal: 0,
                paidLightrail: -50,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
            },
            lineItems: null,
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 950,
                    balanceAfter: 1000,
                    balanceChange: 50,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            paymentSources: null,
            pending: false,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getVoidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${voidRes.body.id}`, "GET");
        chai.assert.equal(getVoidRes.statusCode, 200, `body=${JSON.stringify(getVoidRes.body)}`);
        chai.assert.deepEqual(getVoidRes.body, voidRes.body);

        const valueVoidRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueVoidRes.body.balance, 1000);
    });

    it("can create and capture a pending transaction, Lightrail only", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000,
        };
        const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

        const pendingTx: CheckoutRequest = {
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
                    productId: "🍌",
                    unitPrice: 50
                }
            ],
            currency: "CAD",
            pending: true
        };
        const pendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pendingTx);
        chai.assert.equal(pendingTxRes.statusCode, 201, `body=${JSON.stringify(pendingTxRes.body)}`);
        chai.assert.deepEqualExcluding(pendingTxRes.body, {
            id: pendingTx.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                subtotal: 50,
                tax: 0,
                discount: 0,
                discountLightrail: 0,
                payable: 50,
                paidInternal: 0,
                paidLightrail: 50,
                paidStripe: 0,
                remainder: 0,
                forgiven: 0
            },
            lineItems: [
                {
                    type: "product",
                    productId: "🍌",
                    unitPrice: 50,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 50,
                        taxable: 50,
                        tax: 0,
                        discount: 0,
                        payable: 50,
                        remainder: 0
                    }
                }
            ],
            steps: [
                {
                    rail: "lightrail",
                    valueId: value.id,
                    code: null,
                    contactId: null,
                    balanceBefore: 1000,
                    balanceAfter: 950,
                    balanceChange: -50,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                }
            ],
            paymentSources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                }
            ],
            pending: true,
            pendingVoidDate: null,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "pendingVoidDate"]);
        chai.assert.isNotNull(pendingTxRes.body.pendingVoidDate);

        const getPendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}`, "GET");
        chai.assert.equal(getPendingTxRes.statusCode, 200, `body=${JSON.stringify(getPendingTxRes.body)}`);
        chai.assert.deepEqual(getPendingTxRes.body, pendingTxRes.body);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 950);

        const captureTx: CaptureRequest = {
            id: generateId()
        };
        const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/capture`, "POST", captureTx);
        chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
        chai.assert.deepEqualExcluding(captureRes.body, {
            id: captureTx.id,
            transactionType: "capture",
            currency: "CAD",
            totals: null,
            lineItems: null,
            steps: [],
            paymentSources: null,
            pending: false,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);

        const getCaptureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${captureRes.body.id}`, "GET");
        chai.assert.equal(getCaptureRes.statusCode, 200, `body=${JSON.stringify(getCaptureRes.body)}`);
        chai.assert.deepEqual(getCaptureRes.body, captureRes.body);

        const valueCaptureRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueCaptureRes.body.balance, 950);
    });

    it("can create and void a pending transaction, Lightrail and Stripe", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000,
        };
        const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

        const pendingTx: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 14286,
                    taxRate: 0.05
                }
            ],
            currency: "CAD",
            pending: true
        };
        const pendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pendingTx);
        chai.assert.equal(pendingTxRes.statusCode, 201, `body=${JSON.stringify(pendingTxRes.body)}`);
        chai.assert.deepEqualExcluding(pendingTxRes.body, {
            id: pendingTx.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                subtotal: 14286,
                tax: 714,
                discount: 0,
                discountLightrail: 0,
                payable: 15000,
                paidInternal: 0,
                paidLightrail: 1000,
                paidStripe: 14000,
                remainder: 0,
                forgiven: 0
            },
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 14286,
                    taxRate: 0.05,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 14286,
                        taxable: 14286,
                        tax: 714,
                        discount: 0,
                        payable: 15000,
                        remainder: 0
                    }
                }
            ],
            steps: [
                // only asserted when not live
            ],
            paymentSources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            pending: true,
            pendingVoidDate: null,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "pendingVoidDate", "steps"]);
        chai.assert.isNotNull(pendingTxRes.body.pendingVoidDate);
        chai.assert.equal((pendingTxRes.body.steps[0] as LightrailTransactionStep).balanceBefore, 1000);
        chai.assert.equal((pendingTxRes.body.steps[0] as LightrailTransactionStep).balanceAfter, 0);
        chai.assert.equal((pendingTxRes.body.steps[0] as LightrailTransactionStep).balanceChange, -1000);
        chai.assert.equal((pendingTxRes.body.steps[1] as StripeTransactionStep).amount, -14000);
        chai.assert.isString((pendingTxRes.body.steps[1] as StripeTransactionStep).chargeId);
        chai.assert.isObject((pendingTxRes.body.steps[1] as StripeTransactionStep).charge);
        chai.assert.isFalse(((pendingTxRes.body.steps[1] as StripeTransactionStep).charge as Stripe.charges.ICharge).captured);

        const getPendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}`, "GET");
        chai.assert.equal(getPendingTxRes.statusCode, 200, `body=${JSON.stringify(getPendingTxRes.body)}`);
        chai.assert.deepEqual(getPendingTxRes.body, pendingTxRes.body);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 0);

        const voidTx: VoidRequest = {
            id: generateId()
        };
        const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/void`, "POST", voidTx);
        chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
        chai.assert.isNotTrue(voidRes.body.pending);
        chai.assert.deepEqualExcluding(voidRes.body, {
            id: voidTx.id,
            transactionType: "void",
            currency: "CAD",
            totals: {
                subtotal: -14286,
                tax: -714,
                discount: 0,
                discountLightrail: 0,
                payable: -15000,
                paidInternal: 0,
                paidLightrail: -1000,
                paidStripe: -14000,
                remainder: 0,
                forgiven: 0
            },
            lineItems: null,
            steps: [],
            paymentSources: null,
            pending: false,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "steps"]);
        chai.assert.equal((voidRes.body.steps[0] as LightrailTransactionStep).balanceBefore, 0);
        chai.assert.equal((voidRes.body.steps[0] as LightrailTransactionStep).balanceAfter, 1000);
        chai.assert.equal((voidRes.body.steps[0] as LightrailTransactionStep).balanceChange, 1000);
        chai.assert.equal((voidRes.body.steps[1] as StripeTransactionStep).amount, 14000);
        chai.assert.isString((voidRes.body.steps[1] as StripeTransactionStep).chargeId);
        chai.assert.isObject((voidRes.body.steps[1] as StripeTransactionStep).charge);

        const getVoidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${voidRes.body.id}`, "GET");
        chai.assert.equal(getVoidRes.statusCode, 200, `body=${JSON.stringify(getVoidRes.body)}`);
        chai.assert.deepEqual(getVoidRes.body, voidRes.body);

        const valueVoidRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueVoidRes.body.balance, 1000);
    });

    it("can create and capture a pending transaction, Lightrail and Stripe", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000,
        };
        const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

        const pendingTx: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 14286,
                    taxRate: 0.05
                }
            ],
            currency: "CAD",
            pending: true
        };
        const pendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pendingTx);
        chai.assert.equal(pendingTxRes.statusCode, 201, `body=${JSON.stringify(pendingTxRes.body)}`);
        chai.assert.deepEqualExcluding(pendingTxRes.body, {
            id: pendingTx.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                subtotal: 14286,
                tax: 714,
                discount: 0,
                discountLightrail: 0,
                payable: 15000,
                paidInternal: 0,
                paidLightrail: 1000,
                paidStripe: 14000,
                remainder: 0,
                forgiven: 0
            },
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 14286,
                    taxRate: 0.05,
                    quantity: 1,
                    lineTotal: {
                        subtotal: 14286,
                        taxable: 14286,
                        tax: 714,
                        discount: 0,
                        payable: 15000,
                        remainder: 0
                    }
                }
            ],
            steps: [
                // only asserted when not live
            ],
            paymentSources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            pending: true,
            pendingVoidDate: null,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "pendingVoidDate", "steps"]);
        chai.assert.isNotNull(pendingTxRes.body.pendingVoidDate);
        chai.assert.equal((pendingTxRes.body.steps[0] as LightrailTransactionStep).balanceBefore, 1000);
        chai.assert.equal((pendingTxRes.body.steps[0] as LightrailTransactionStep).balanceAfter, 0);
        chai.assert.equal((pendingTxRes.body.steps[0] as LightrailTransactionStep).balanceChange, -1000);
        chai.assert.equal((pendingTxRes.body.steps[1] as StripeTransactionStep).amount, -14000);
        chai.assert.isString((pendingTxRes.body.steps[1] as StripeTransactionStep).chargeId);
        chai.assert.isObject((pendingTxRes.body.steps[1] as StripeTransactionStep).charge);
        chai.assert.isFalse(((pendingTxRes.body.steps[1] as StripeTransactionStep).charge as Stripe.charges.ICharge).captured);

        const getPendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}`, "GET");
        chai.assert.equal(getPendingTxRes.statusCode, 200, `body=${JSON.stringify(getPendingTxRes.body)}`);
        chai.assert.deepEqual(getPendingTxRes.body, pendingTxRes.body);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 0);

        const captureTx: CaptureRequest = {
            id: generateId()
        };
        const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/capture`, "POST", captureTx);
        chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);

        chai.assert.deepEqualExcluding(captureRes.body, {
            id: captureTx.id,
            transactionType: "capture",
            currency: "CAD",
            totals: null,
            lineItems: null,
            steps: [],
            paymentSources: null,
            pending: false,
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "steps"]);
        chai.assert.equal((captureRes.body.steps[0] as StripeTransactionStep).rail, "stripe");
        chai.assert.equal((captureRes.body.steps[0] as StripeTransactionStep).amount, 0);
        chai.assert.isString((captureRes.body.steps[0] as StripeTransactionStep).chargeId);
        chai.assert.isObject((captureRes.body.steps[0] as StripeTransactionStep).charge);

        const getCaptureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${captureRes.body.id}`, "GET");
        chai.assert.equal(getCaptureRes.statusCode, 200, `body=${JSON.stringify(getCaptureRes.body)}`);
        chai.assert.deepEqual(getCaptureRes.body, captureRes.body);

        const valueCaptureRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueCaptureRes.body.balance, 0);
    });

    it("voids Lightrail+Stripe successfully when the Stripe charge was refunded already", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000,
        };
        const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

        const pendingTx: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 14286,
                    taxRate: 0.05
                }
            ],
            currency: "CAD",
            pending: true
        };
        const pendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pendingTx);
        chai.assert.equal(pendingTxRes.statusCode, 201, `body=${JSON.stringify(pendingTxRes.body)}`);
        chai.assert.isTrue(pendingTxRes.body.pending);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 0);

        // Refund the charge manually
        const refund = await createRefund({charge: (pendingTxRes.body.steps[1] as StripeTransactionStep).chargeId}, true, stripeLiveMerchantConfig.stripeUserId);

        const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/void`, "POST", {
            id: generateId()
        });
        chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
        chai.assert.isNotTrue(voidRes.body.pending);
        chai.assert.deepEqual(voidRes.body.steps, [
            {
                rail: "lightrail",
                balanceAfter: 1000,
                balanceBefore: 0,
                balanceChange: 1000,
                code: null,
                contactId: null,
                usesRemainingAfter: null,
                usesRemainingBefore: null,
                usesRemainingChange: null,
                valueId: value.id
            },
            {
                rail: "stripe",
                chargeId: refund.charge,
                amount: refund.amount,
                charge: refund
            } as StripeTransactionStep
        ]);

        const valueVoidRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueVoidRes.body.balance, 1000);
    });

    it("captures Lightrail+Stripe when the Stripe charge was captured already", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000,
        };
        const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(valueRes.statusCode, 201, `body=${JSON.stringify(valueRes.body)}`);

        const pendingTx: CheckoutRequest = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 14286,
                    taxRate: 0.05
                }
            ],
            currency: "CAD",
            pending: true
        };
        const pendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pendingTx);
        chai.assert.equal(pendingTxRes.statusCode, 201, `body=${JSON.stringify(pendingTxRes.body)}`);
        chai.assert.isTrue(pendingTxRes.body.pending);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 0);

        // Capture the charge manually.
        const capture = await captureCharge((pendingTxRes.body.steps[1] as StripeTransactionStep).chargeId, {}, true, stripeLiveMerchantConfig.stripeUserId);

        const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/capture`, "POST", {
            id: generateId()
        });
        chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
        chai.assert.isNotTrue(captureRes.body.pending);
        chai.assert.deepEqual(captureRes.body.steps, [
            {
                rail: "stripe",
                chargeId: capture.id,
                amount: 0,
                charge: capture
            } as StripeTransactionStep
        ]);

        const valueCaptureRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueCaptureRes.body.balance, 0);
    });
});

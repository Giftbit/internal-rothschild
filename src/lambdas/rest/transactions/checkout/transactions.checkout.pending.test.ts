import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../../utils/testUtils";
import {Value} from "../../../../model/Value";
import {Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import chaiExclude = require("chai-exclude");
import {CheckoutRequest} from "../../../../model/TransactionRequest";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../../utils/testUtils/stripeTestUtils";
import {after} from "mocha";

chai.use(chaiExclude);

describe.only("/v2/transactions/checkout - pending", () => {

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

        const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/void`, "POST", {
            id: generateId()
        });
        chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
        chai.assert.isNotTrue(voidRes.body.pending);

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

        const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/capture`, "POST", {
            id: generateId()
        });
        chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
        chai.assert.isNotTrue(captureRes.body.pending);

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
                    unitPrice: 15000
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
            },
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 15000,
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
                    balanceAfter: 0,
                    balanceChange: -1000,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                },
                {
                    rail: "stripe",
                    amount: 5000
                }
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
        }, ["createdDate", "pendingVoidDate"]);
        chai.assert.isNotNull(pendingTxRes.body.pendingVoidDate);

        const getPendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}`, "GET");
        chai.assert.equal(getPendingTxRes.statusCode, 200, `body=${JSON.stringify(getPendingTxRes.body)}`);
        chai.assert.deepEqual(getPendingTxRes.body, pendingTxRes.body);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 0);

        const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/void`, "POST", {
            id: generateId()
        });
        chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
        chai.assert.isNotTrue(voidRes.body.pending);

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
                    unitPrice: 15000
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
            },
            lineItems: [
                {
                    type: "product",
                    productId: "🚗",
                    unitPrice: 15000,
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
                    balanceAfter: 0,
                    balanceChange: -1000,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                },
                {
                    rail: "stripe",
                    amount: 5000
                }
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
        }, ["createdDate", "pendingVoidDate"]);
        chai.assert.isNotNull(pendingTxRes.body.pendingVoidDate);

        const getPendingTxRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}`, "GET");
        chai.assert.equal(getPendingTxRes.statusCode, 200, `body=${JSON.stringify(getPendingTxRes.body)}`);
        chai.assert.deepEqual(getPendingTxRes.body, pendingTxRes.body);

        const valuePendingRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valuePendingRes.body.balance, 0);

        const captureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingTx.id}/capture`, "POST", {
            id: generateId()
        });
        chai.assert.equal(captureRes.statusCode, 201, `body=${JSON.stringify(captureRes.body)}`);
        chai.assert.isNotTrue(captureRes.body.pending);

        const getCaptureRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${captureRes.body.id}`, "GET");
        chai.assert.equal(getCaptureRes.statusCode, 200, `body=${JSON.stringify(getCaptureRes.body)}`);
        chai.assert.deepEqual(getCaptureRes.body, captureRes.body);

        const valueCaptureRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueCaptureRes.body.balance, 0);
    });
});

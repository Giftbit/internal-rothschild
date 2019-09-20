import * as chai from "chai";
import * as cassava from "cassava";
import * as awslambda from "aws-lambda";
import * as testUtils from "../../utils/testUtils";
import {generateId} from "../../utils/testUtils";
import * as currencies from "../rest/currencies";
import {Value} from "../../model/Value";
import {nowInDbPrecision} from "../../utils/dbUtils";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {installRestRoutes} from "../rest/installRestRoutes";
import {Transaction} from "../../model/Transaction";
import {CheckoutRequest, DebitRequest} from "../../model/TransactionRequest";
import {voidExpiredPending} from "./voidExpiredPending";
import {setStubsForStripeTests, testStripeLive, unsetStubsForStripeTests} from "../../utils/testUtils/stripeTestUtils";

describe.only("voidExpiredPending()", () => {

    const now = nowInDbPrecision();
    const past = new Date(now);
    past.setDate(now.getDate() - 1);
    const future = new Date(now);
    future.setDate(future.getDate() + 1);

    // Using the router here creates a cross dependency between this test and the rest code.
    // On the other hand it's the easiest way to ensure we're setting up the state correctly.
    const router = new cassava.Router();

    before(async () => {
        setStubsForStripeTests();
        await testUtils.resetDb();

        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await currencies.createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian bucks",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("voids pending transactions with passed pendingVoidDates", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201);

        const pastPendingDebitTx1: DebitRequest = {
            id: "pastPendingDebitTx1",
            amount: 1,
            currency: "CAD",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            pending: true
        };
        const pastPendingDebitRes1 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pastPendingDebitTx1);
        chai.assert.equal(pastPendingDebitRes1.statusCode, 201);
        await updateTransactionPendingVoidDate(pastPendingDebitTx1.id, past);

        const pastPendingDebitTx2: DebitRequest = {
            id: "pastPendingDebitTx2",
            amount: 3,
            currency: "CAD",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            pending: true
        };
        const pastPendingDebitRes2 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", pastPendingDebitTx2);
        chai.assert.equal(pastPendingDebitRes2.statusCode, 201);
        await updateTransactionPendingVoidDate(pastPendingDebitTx2.id, past);

        const pastPendingStripeCheckoutTx: CheckoutRequest = {
            id: "pastPendingStripeCheckoutTx",
            currency: "cad",
            lineItems: [
                {
                    type: "product",
                    productId: "butterfly_kisses",
                    unitPrice: 1499
                }
            ],
            sources: [
                {
                    rail: "stripe",
                    source: "tok_visa"
                }
            ],
            pending: true
        };
        const stripePendingCheckoutTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", pastPendingStripeCheckoutTx);
        chai.assert.equal(stripePendingCheckoutTxRes.statusCode, 201);
        await updateTransactionPendingVoidDate(pastPendingStripeCheckoutTx.id, past);

        const futurePendingDebitTx: DebitRequest = {
            id: "futurePendingDebitTx",
            amount: 5,
            currency: "CAD",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            pending: true
        };
        const futurePendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", futurePendingDebitTx);
        chai.assert.equal(futurePendingDebitRes.statusCode, 201);
        await updateTransactionPendingVoidDate(futurePendingDebitTx.id, future);

        const capturedPendingDebitTx: DebitRequest = {
            id: "capturedPendingDebitTx",
            amount: 7,
            currency: "CAD",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            pending: true
        };
        const capturedPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", capturedPendingDebitTx);
        chai.assert.equal(capturedPendingDebitRes.statusCode, 201);
        const captureCapturedPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${capturedPendingDebitTx.id}/capture`, "POST", {
            id: generateId()
        });
        chai.assert.equal(captureCapturedPendingDebitRes.statusCode, 201);

        const voidedPendingDebitTx: DebitRequest = {
            id: "voidedPendingDebitTx",
            amount: 11,
            currency: "CAD",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            pending: true
        };
        const voidedPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", voidedPendingDebitTx);
        chai.assert.equal(voidedPendingDebitRes.statusCode, 201);
        const voidVoidedPendingDebitRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${voidedPendingDebitTx.id}/void`, "POST", {
            id: generateId()
        });
        chai.assert.equal(voidVoidedPendingDebitRes.statusCode, 201);

        // All that setup for this.
        await voidExpiredPending(getLambdaContext());

        await assertTransactionVoided(router, pastPendingDebitTx1.id);
        await assertTransactionVoided(router, pastPendingDebitTx2.id);
        await assertTransactionVoided(router, pastPendingStripeCheckoutTx.id);
        await assertTransactionVoided(router, voidedPendingDebitTx.id);
        await assertTransactionNotVoided(router, futurePendingDebitTx.id);
        await assertTransactionNotVoided(router, capturedPendingDebitTx.id);

        const valueRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
        chai.assert.equal(valueRes.statusCode, 200);
        chai.assert.equal(valueRes.body.balance, value.balance - futurePendingDebitTx.amount - capturedPendingDebitTx.amount);
    });

    it("voids the transaction even if the Value is frozen", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 1000
        };
        const postValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201);

        const txReq: DebitRequest = {
            id: generateId(),
            amount: 500,
            currency: "CAD",
            source: {
                rail: "lightrail",
                valueId: value.id
            },
            pending: true
        };
        const txResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", txReq);
        chai.assert.equal(txResp.statusCode, 201);
        await updateTransactionPendingVoidDate(txReq.id, past);

        const freezeValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", {frozen: true});
        chai.assert.equal(freezeValueResp.statusCode, 200);

        await voidExpiredPending(getLambdaContext());

        await assertTransactionVoided(router, txReq.id);
    });

    it("does not choke when Stripe test data is deleted", async function () {
        if (testStripeLive()) {
            // This test relies upon a test token only supported in the local mock server.
            this.skip();
        }

        const stripeCheckoutTx: CheckoutRequest = {
            id: generateId(),
            currency: "cad",
            lineItems: [
                {
                    type: "product",
                    productId: "butterfly_kisses",
                    unitPrice: 1499
                }
            ],
            sources: [
                {
                    rail: "stripe",
                    source: "tok_forget"    // Mock server will forget about this charge.
                }
            ],
            pending: true
        };
        const stripePendingCheckoutTxRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", stripeCheckoutTx);
        chai.assert.equal(stripePendingCheckoutTxRes.statusCode, 201);
        await updateTransactionPendingVoidDate(stripeCheckoutTx.id, past);

        await voidExpiredPending(getLambdaContext());

        // TODO probably not the right outcome
        await assertTransactionVoided(router, stripeCheckoutTx.id);
    });
});

function getLambdaContext(): awslambda.Context {
    return {
        getRemainingTimeInMillis: () => 5 * 60 * 1000
    } as any;
}

async function updateTransactionPendingVoidDate(transactionId: string, date: Date): Promise<void> {
    const knex = await getKnexWrite();

    const pendingDebitUpdate: number = await knex("Transactions")
        .where({id: transactionId})
        .update({pendingVoidDate: date});
    chai.assert.equal(pendingDebitUpdate, 1, `Expected to updated transaction '${transactionId}'.`);
}

async function assertTransactionVoided(router: cassava.Router, transactionId: string): Promise<void> {
    const txRes = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${transactionId}/chain`, "GET");
    chai.assert.equal(txRes.statusCode, 200, `Getting transaction ${transactionId}.`);
    chai.assert.lengthOf(txRes.body, 2, `2 transactions in chain for transaction ${transactionId}.`);

    // These transactions might not be in the right order because they can happen in the same second,
    // which is the time resolution of the DB.

    const pendingTx = txRes.body.find(tx => tx.id === transactionId);
    chai.assert.isObject(pendingTx, `Find pending tx in chain for ${transactionId}.`);
    chai.assert.isTrue(pendingTx.pending, `Transaction ${transactionId} is created pending.`);

    const voidTx = txRes.body.find(tx => tx.id !== transactionId);
    chai.assert.isObject(voidTx, `Find void tx in chain for ${transactionId}.`);
    chai.assert.equal(voidTx.transactionType, "void", `Transaction ${transactionId} is voided.`);
}

async function assertTransactionNotVoided(router: cassava.Router, transactionId: string): Promise<void> {
    const txRes = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions/${transactionId}/chain`, "GET");
    chai.assert.equal(txRes.statusCode, 200, `Getting transaction ${transactionId}.`);

    const pendingTx = txRes.body.find(tx => tx.id === transactionId);
    chai.assert.isObject(pendingTx, `Find pending tx in chain for ${transactionId}.`);
    chai.assert.isTrue(pendingTx.pending, `Transaction ${transactionId} is created pending.`);

    if (txRes.body.length > 1) {
        chai.assert.lengthOf(txRes.body, 2, `2 transactions in chain for transaction ${transactionId}.`);

        const otherTx = txRes.body.find(tx => tx.id !== transactionId);
        chai.assert.isObject(otherTx, `Find other tx in chain for ${transactionId}.`);
        chai.assert.notEqual(otherTx.transactionType, "void", `Transaction ${transactionId} is *not* voided.`);
    }
}

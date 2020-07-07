import * as cassava from "cassava";
import * as chai from "chai";
import {Currency} from "../../../model/Currency";
import * as testUtils from "../../../utils/testUtils";
import {generateId} from "../../../utils/testUtils";
import {installRestRoutes} from "../../rest/installRestRoutes";
import {testLightrailEvents} from "../startBinlogWatcher";
import {createCurrency} from "../../rest/currencies";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {assertIsLightrailEvent} from "./assertIsLightrailEvent";
import {Value} from "../../../model/Value";
import {CheckoutRequest, CreditRequest, VoidRequest} from "../../../model/TransactionRequest";
import {Transaction} from "../../../model/Transaction";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../utils/testUtils/stripeTestUtils";

describe("getTransactionEvents()", () => {

    const router = new cassava.Router();

    const currency: Currency = {
        code: "CAD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Pelts",
        createdBy: testUtils.defaultTestUser.teamMemberId,
        createdDate: nowInDbPrecision(),
        updatedDate: nowInDbPrecision()
    };

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        testUtils.setCodeCryptographySecrets();
        await setStubsForStripeTests();
        await createCurrency(testUtils.defaultTestUser.auth, currency);
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("creates events for Credit Transaction created", async () => {
        const createValueRequest: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 0
        };
        const createValueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", createValueRequest);
        chai.assert.equal(createValueRes.statusCode, 201, `body=${JSON.stringify(createValueRes.body)}`);

        const creditRequest: CreditRequest = {
            id: generateId(),
            amount: 500,
            currency: "CAD",
            destination: {
                rail: "lightrail",
                valueId: createValueRequest.id
            }
        };
        let createdTransaction: Transaction = null;
        let valueUpdated: Value = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const createRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", creditRequest);
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
            createdTransaction = createRes.body;

            const getValueRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueRequest.id}`, "GET");
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
            valueUpdated = getValueRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 2);

        const event = lightrailEvents.find(e => e.type === "lightrail.transaction.created");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.newTransaction, createdTransaction);

        const valueEvent = lightrailEvents.find(e => e.type === "lightrail.value.updated");
        assertIsLightrailEvent(valueEvent);
        chai.assert.deepEqual(valueEvent.data.oldValue, createValueRes.body);
        chai.assert.deepEqual(valueEvent.data.newValue, valueUpdated);
    });

    it("creates events for pending and void Checkout Transaction created", async () => {
        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: "CAD",
            lineItems: [
                {
                    type: "product",
                    productId: generateId(),
                    quantity: 1,
                    unitPrice: 2500
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
        let checkoutTransaction: Transaction = null;

        const voidRequest: VoidRequest = {
            id: generateId()
        };
        let voidTransaction: Transaction = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const checkoutRes = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkoutRes.statusCode, 201, `body=${JSON.stringify(checkoutRes.body)}`);
            checkoutTransaction = checkoutRes.body;

            const voidRes = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutRequest.id}/void`, "POST", voidRequest);
            chai.assert.equal(voidRes.statusCode, 201, `body=${JSON.stringify(voidRes.body)}`);
            voidTransaction = voidRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 2);

        const checkoutEvent = lightrailEvents.find(e => e.type === "lightrail.transaction.created" && e.data.newTransaction.transactionType === "checkout");
        assertIsLightrailEvent(checkoutEvent);
        chai.assert.deepEqual(checkoutEvent.data.newTransaction, checkoutTransaction);

        const voidEvent = lightrailEvents.find(e => e.type === "lightrail.transaction.created" && e.data.newTransaction.transactionType === "void");
        assertIsLightrailEvent(voidEvent);
        chai.assert.deepEqual(voidEvent.data.newTransaction, voidTransaction);
    });
});

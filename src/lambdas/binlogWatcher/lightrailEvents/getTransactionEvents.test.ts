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
import {CreditRequest} from "../../../model/TransactionRequest";
import {Transaction} from "../../../model/Transaction";

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
        await createCurrency(testUtils.defaultTestUser.auth, currency);
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
});

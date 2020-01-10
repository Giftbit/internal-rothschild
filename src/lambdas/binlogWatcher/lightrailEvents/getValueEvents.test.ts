import * as cassava from "cassava";
import * as chai from "chai";
import {Currency} from "../../../model/Currency";
import * as testUtils from "../../../utils/testUtils";
import {generateId} from "../../../utils/testUtils";
import {installRestRoutes} from "../../rest/installRestRoutes";
import {testLightrailEvents} from "../startBinlogWatcher";
import {setStubsForStripeTests} from "../../../utils/testUtils/stripeTestUtils";
import {createCurrency} from "../../rest/currencies";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {Value} from "../../../model/Value";
import {assertIsLightrailEvent} from "./assertIsLightrailEvent";

describe("getValueEvents()", () => {

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

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        testUtils.setCodeCryptographySecrets();
        await setStubsForStripeTests();
        await createCurrency(testUtils.defaultTestUser.auth, currency);
    });

    it("creates events for Value created", async () => {
        const createValueRequest: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 0
        };
        let valueCreated: Value = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const createRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", createValueRequest);
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
            valueCreated = createRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 2);

        const txEvent = lightrailEvents.find(e => e.type === "lightrail.transaction.created");
        assertIsLightrailEvent(txEvent);
        chai.assert.equal(txEvent.data.newTransaction.currency, createValueRequest.currency);
        chai.assert.lengthOf(txEvent.data.newTransaction.steps, 1);
        chai.assert.equal(txEvent.data.newTransaction.steps[0].rail, "lightrail");
        chai.assert.equal(txEvent.data.newTransaction.steps[0].valueId, createValueRequest.id);

        const valueEvent = lightrailEvents.find(e => e.type === "lightrail.value.created");
        assertIsLightrailEvent(valueEvent);
        chai.assert.deepEqual(valueEvent.data.newValue, valueCreated);
    });

    it("creates an event for Value updated", async () => {
        const createValueRequest: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 0
        };
        const createRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", createValueRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        let valueUpdated: Value = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueRequest.id}`, "PATCH", {discount: true});
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
            valueUpdated = updateRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const valueEvent = lightrailEvents.find(e => e.type === "lightrail.value.updated");
        assertIsLightrailEvent(valueEvent);
        chai.assert.deepEqual(valueEvent.data.oldValue, createRes.body);
        chai.assert.deepEqual(valueEvent.data.newValue, valueUpdated);
    });
});

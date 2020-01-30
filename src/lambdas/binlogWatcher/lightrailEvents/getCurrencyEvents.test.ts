import * as cassava from "cassava";
import * as chai from "chai";
import {Currency} from "../../../model/Currency";
import * as testUtils from "../../../utils/testUtils";
import {installRestRoutes} from "../../rest/installRestRoutes";
import {testLightrailEvents} from "../startBinlogWatcher";
import {assertIsLightrailEvent} from "./assertIsLightrailEvent";

describe("getCurrencyEvents()", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        testUtils.setCodeCryptographySecrets();
    });

    it("creates events for Currency created", async () => {
        const createCurrencyRequest: Partial<Currency> = {
            code: "CAPS",
            name: "Bottle Caps",
            decimalPlaces: 0,
            symbol: "C"
        };
        let currencyCreated: Currency = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const createRes = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", createCurrencyRequest);
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
            currencyCreated = createRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.currency.created");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.newCurrency, currencyCreated);
    });

    it("creates an event for Currency updated", async () => {
        const createCurrencyRequest: Partial<Currency> = {
            code: "BTC",
            name: "Bitcoin (lol)",
            decimalPlaces: 3,
            symbol: "BTC"
        };
        const createRes = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", createCurrencyRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        let currencyUpdated: Currency = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${createCurrencyRequest.code}`, "PATCH", {decimalPlaces: 4});
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
            currencyUpdated = updateRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.currency.updated");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.oldCurrency, createRes.body);
        chai.assert.deepEqual(event.data.newCurrency, currencyUpdated);
    });

    it("creates an event for Currency deleted", async () => {
        const createCurrencyRequest: Partial<Currency> = {
            code: "PEBBLES",
            name: "Shiny pebbles I found on a beach",
            decimalPlaces: 0,
            symbol: "P"
        };
        const createRes = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", createCurrencyRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Currency>(router, `/v2/currencies/${createCurrencyRequest.code}`, "DELETE");
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.currency.deleted");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.oldCurrency, createRes.body);
    });
});

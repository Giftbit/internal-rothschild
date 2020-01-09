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

describe.only("getValueEvents()", () => {

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
            balance: 500
        };

        const lightrailEvents = await testLightrailEvents(async () => {
            console.log("!!!!!!!!!!!!!!!!!!!!!!!!!");
            const createRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", createValueRequest);
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        });
        chai.assert.lengthOf(lightrailEvents, 1);
        chai.assert.equal(lightrailEvents[1].data.id, createValueRequest.id);
        chai.assert.equal(lightrailEvents[1].data.currency, createValueRequest.balance);
    });
});

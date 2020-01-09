import * as cassava from "cassava";
import {Currency} from "../../model/Currency";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {LightrailEventMockPublisher} from "./lightrailEventPublisher/LightrailEventMockPublisher";
import {startBinlogWatcher} from "./startBinlogWatcher";

describe.only("binlogWatcher", () => {

    const router = new cassava.Router();

    const currency: Partial<Currency> = {
        code: "CAD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Pelts"
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        testUtils.setCodeCryptographySecrets();
        // await setStubsForStripeTests();
        // await createCurrency(testUtils.defaultTestUser.auth, currency);
    });

    it("test", async () => {
        // TODO use this to test getting mysql to start fresh every time
        const stateManager = new BinlogWatcherStateManager();
        stateManager.state = {
            id: "BinlogWatcherState",
            checkpoint: null
        };
        const publisher = new LightrailEventMockPublisher();
        const binlogStream = await startBinlogWatcher(stateManager, publisher);

        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(publisher.events);
    });

    it("test better", async () => {
        const lightrailEvents = await testLightrailEvents(async () => {
            // make some rest calls
        });
    });
});

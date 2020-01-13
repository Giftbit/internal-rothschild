import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {BinlogWatcherStateManager} from "./binlogWatcherState/BinlogWatcherStateManager";
import {LightrailEventMockPublisher} from "./lightrailEventPublisher/LightrailEventMockPublisher";
import {startBinlogWatcher} from "./startBinlogWatcher";
import {Currency} from "../../model/Currency";
import {nowInDbPrecision} from "../../utils/dbUtils";
import {createCurrency} from "../rest/currencies";

describe("startBinlogWatcher()", () => {
    it("starts a BinlogStream, wiring up the BinlogWatcherStateManager and LightrailEventPublisher", async () => {
        const stateManager = new BinlogWatcherStateManager();
        stateManager.state = {
            id: "BinlogWatcherState",
            checkpoint: null
        };
        const publisher = new LightrailEventMockPublisher();
        const binlogStream = await startBinlogWatcher(stateManager, publisher);

        await testUtils.resetDb();
        const currency: Currency = {
            code: "CAD",
            decimalPlaces: 2,
            symbol: "$",
            name: "Pelts",
            createdBy: testUtils.defaultTestUser.teamMemberId,
            createdDate: nowInDbPrecision(),
            updatedDate: nowInDbPrecision()
        };
        await createCurrency(testUtils.defaultTestUser.auth, currency);

        await new Promise(resolve => setTimeout(resolve, 1500));

        await binlogStream.stop();

        chai.assert.isObject(stateManager.state.checkpoint);
        chai.assert.isString(stateManager.state.checkpoint.binlogName);
        chai.assert.isNumber(stateManager.state.checkpoint.binlogPosition);
        chai.assert.lengthOf(publisher.events, 1);
    }).timeout(5000);
});

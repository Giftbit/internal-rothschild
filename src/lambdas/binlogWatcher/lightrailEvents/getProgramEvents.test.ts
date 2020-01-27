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
import {Program} from "../../../model/Program";

describe("getProgramEvents()", () => {

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

    it("creates events for Program created", async () => {
        const createProgramRequest: Partial<Program> = {
            id: generateId(),
            currency: "CAD",
            name: "Program McTestface",
            discount: true,
            minInitialBalance: 500,
            maxInitialBalance: 5000
        };
        let programCreated: Program = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const createRes = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", createProgramRequest);
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
            programCreated = createRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.program.created");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.newProgram, programCreated);
    });

    it("creates an event for Program updated", async () => {
        const createProgramRequest: Partial<Program> = {
            id: generateId(),
            currency: "CAD",
            name: "Son of Program McTestface",
            discount: true,
            minInitialBalance: 500,
            maxInitialBalance: 5000
        };
        const createRes = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", createProgramRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        let programUpdated: Program = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${createProgramRequest.id}`, "PATCH", {discount: false});
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
            programUpdated = updateRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.program.updated");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.oldProgram, createRes.body);
        chai.assert.deepEqual(event.data.newProgram, programUpdated);
    });

    it("creates an event for Program deleted", async () => {
        const createProgramRequest: Partial<Program> = {
            id: generateId(),
            currency: "CAD",
            name: "Son of Program McTestface Jr The Third",
            discount: true,
            minInitialBalance: 500,
            maxInitialBalance: 5000
        };
        const createRes = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", createProgramRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Program>(router, `/v2/programs/${createProgramRequest.id}`, "DELETE");
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.program.deleted");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.oldProgram, createRes.body);
    });
});

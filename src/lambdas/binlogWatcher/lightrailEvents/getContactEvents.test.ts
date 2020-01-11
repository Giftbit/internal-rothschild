import * as cassava from "cassava";
import * as chai from "chai";
import {Currency} from "../../../model/Currency";
import * as testUtils from "../../../utils/testUtils";
import {generateId} from "../../../utils/testUtils";
import {installRestRoutes} from "../../rest/installRestRoutes";
import {testLightrailEvents} from "../startBinlogWatcher";
import {assertIsLightrailEvent} from "./assertIsLightrailEvent";
import {Contact} from "../../../model/Contact";

describe("getContactEvents()", () => {

    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        testUtils.setCodeCryptographySecrets();
    });

    it("creates events for Contact created", async () => {
        const createContactRequest: Partial<Contact> = {
            id: generateId(),
            email: `${generateId()}@example.com`
        };
        let contactCreated: Contact = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const createRes = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", createContactRequest);
            chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
            contactCreated = createRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const event = lightrailEvents.find(e => e.type === "lightrail.contact.created");
        assertIsLightrailEvent(event);
        chai.assert.deepEqual(event.data.newContact, contactCreated);
    });

    it("creates an event for Contact updated", async () => {
        const createContactRequest: Partial<Contact> = {
            id: generateId(),
            email: `${generateId()}@example.com`
        };
        const createRes = await testUtils.testAuthedRequest<Currency>(router, "/v2/contacts", "POST", createContactRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);
        let contactUpdated: Contact = null;

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${createContactRequest.id}`, "PATCH", {email: `${generateId()}@example.com`});
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
            contactUpdated = updateRes.body;
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const programEvent = lightrailEvents.find(e => e.type === "lightrail.contact.updated");
        assertIsLightrailEvent(programEvent);
        chai.assert.deepEqual(programEvent.data.oldContact, createRes.body);
        chai.assert.deepEqual(programEvent.data.newContact, contactUpdated);
    });

    it("creates an event for Contact deleted", async () => {
        const createContactRequest: Partial<Contact> = {
            id: generateId(),
            email: `${generateId()}@example.com`
        };
        const createRes = await testUtils.testAuthedRequest<Currency>(router, "/v2/contacts", "POST", createContactRequest);
        chai.assert.equal(createRes.statusCode, 201, `body=${JSON.stringify(createRes.body)}`);

        const lightrailEvents = await testLightrailEvents(async () => {
            const updateRes = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${createContactRequest.id}`, "DELETE");
            chai.assert.equal(updateRes.statusCode, 200, `body=${JSON.stringify(updateRes.body)}`);
        });
        chai.assert.lengthOf(lightrailEvents, 1);

        const programEvent = lightrailEvents.find(e => e.type === "lightrail.contact.deleted");
        assertIsLightrailEvent(programEvent);
        chai.assert.deepEqual(programEvent.data.oldContact, createRes.body);
    });
});

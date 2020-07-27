import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {defaultTestUser, generateId} from "../../utils/testUtils";
import {Contact, DbContact} from "../../model/Contact";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {Value} from "../../model/Value";
import {Currency} from "../../model/Currency";
import {installRestRoutes} from "./installRestRoutes";
import chaiExclude from "chai-exclude";
import {GiftbitRestError} from "giftbit-cassava-routes";
import {Transaction} from "../../model/Transaction";
import parseLinkHeader = require("parse-link-header");

chai.use(chaiExclude);

describe("/v2/contacts", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
    });

    it("can list 0 contacts", async () => {
        const resp = await testUtils.testAuthedRequest<Contact[]>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    it("can list 0 contacts with csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "10000");
    });

    let contact1: Partial<Contact> = {
        id: "c1",
        firstName: "First",
        lastName: "Last",
        email: "email@example.com"
    };

    it("can create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact1);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.deepEqualExcluding(resp.body, {
            ...contact1,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "metadata", "createdBy"]);
        contact1 = resp.body;
    });

    it("can get the contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact1.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, contact1);
    });

    it("can list 1 contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact[]>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, [
            contact1
        ]);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    it("can list 1 contact in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [contact1], ["createdDate", "updatedDate"]);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "10000");
    });

    it("requires an id to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            ...contact1,
            id: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("can't create a contact with non-ascii characters in the ID", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            id: generateId() + "🐭",
            firstName: "First",
            lastName: "Last",
            email: "email@example.com"
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a string id to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            ...contact1,
            id: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires firstName is a string to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            ...contact1,
            firstName: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires lastName is a string to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            ...contact1,
            lastName: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires email is a string to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            ...contact1,
            email: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    let contact2: Partial<Contact> = {
        id: "c2"
    };

    it("only requires id to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact2);
        chai.assert.deepEqualExcluding(resp.body, {
            ...contact2,
            firstName: null,
            lastName: null,
            email: null,
            createdBy: defaultTestUser.auth.teamMemberId
        } as Contact, ["createdDate", "updatedDate", "metadata", "createdBy"]);
        chai.assert.equal(resp.statusCode, 201);
        contact2 = resp.body;
    });

    const contact3: Partial<Contact> & { userId: string } = {
        id: "c3",
        userId: "malicious"
    };

    it("can't override the userId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/contacts", "POST", contact3);
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("can modify the contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact1.id}`, "PATCH", {
            firstName: contact1.firstName = "Customer",
            lastName: contact1.lastName = "One"
        });
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, contact1, ["updatedDate"]);
        contact1 = resp.body;

        const getResp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact1.id}`, "GET");
        chai.assert.equal(getResp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, contact1);
    });

    it("can't update contact id", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact1.id}`, "PATCH", {
            id: generateId()
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("409s on creating a duplicate contact", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/contacts", "POST", {
            id: contact1.id,
            firstName: "Duplicate"
        });
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ContactIdExists");
    });

    it("422s on creating a contact with an id that is too long", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: "01234567890123456789012345678901234567890123456789012345678901234567890123456789"});
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("422s on creating a contact with non-ascii characters in email address", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            id: generateId(),
            email: "jon－paul@example.com"   // That's an em dash, not an ascii dash.
        });
        chai.assert.equal(resp.statusCode, 422, `body=${JSON.stringify(resp.body)}`);
    });

    it("404s on getting invalid id", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/iamnotavalidcontactid`, "GET");
        chai.assert.equal(resp.statusCode, 404, `body=${JSON.stringify(resp.body)}`);
    });

    it("404s on modifying invalid id", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/iamnotavalidcontactid`, "PUT", contact1);
        chai.assert.equal(resp.statusCode, 404, `body=${JSON.stringify(resp.body)}`);
    });

    it("can list 2 contacts", async () => {
        const resp = await testUtils.testAuthedRequest<Contact[]>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, [
            {
                ...contact2,
                createdBy: defaultTestUser.auth.teamMemberId
            },
            {
                ...contact1,
                createdBy: defaultTestUser.auth.teamMemberId
            }
        ], ["createdBy"]);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "1000");
    });

    it("can list 2 contacts in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            {
                ...contact2,
                createdBy: defaultTestUser.auth.teamMemberId
            },
            {
                ...contact1,
                createdBy: defaultTestUser.auth.teamMemberId
            }
        ], ["createdDate", "updatedDate", "createdBy"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["Max-Limit"], "10000");
    });

    let contact4: Partial<Contact> = {
        id: "c4",
        firstName: "contact4",
        metadata: {
            strings: "supported",
            numbers: 1,
            booleans: true,
            arrays: ["also", "supported"],
            nested: {
                also: "supported"
            }
        }
    };

    it("can create a contact with metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact4);
        chai.assert.equal(resp.statusCode, 201, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, {
            ...contact4,
            lastName: null,
            email: null,
            createdBy: defaultTestUser.auth.teamMemberId
        } as Contact, ["createdDate", "updatedDate", "createdBy"]);
        contact4 = resp.body;
    });

    it("can get the contact with metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact4.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqualExcluding(resp.body, {
            ...contact4,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdBy"]);
        chai.assert.deepEqual(resp.body, {...contact4, createdBy: defaultTestUser.auth.teamMemberId});
    });

    it("can delete a Contact that is not in use", async () => {
        const contact: Partial<Contact> = {
            id: "jerry",
            firstName: "Jerry",
            lastName: "The Contact",
            email: "jerry@contact.com"
        };

        const resp1 = await testUtils.testAuthedRequest<any>(router, "/v2/contacts", "POST", contact);
        chai.assert.equal(resp1.statusCode, 201, `create body=${JSON.stringify(resp1.body)}`);

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}`, "DELETE");
        chai.assert.equal(resp3.statusCode, 200, `delete body=${JSON.stringify(resp3.body)}`);

        const resp4 = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}`, "GET");
        chai.assert.equal(resp4.statusCode, 404, `get deleted body=${JSON.stringify(resp4.body)}`);
    });

    it("404s on deleting a Contact that does not exist", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/idonotexist`, "DELETE");
        chai.assert.equal(resp.statusCode, 404, `delete body=${JSON.stringify(resp.body)}`);
    });

    it("409s on deleting a Contact in use", async () => {
        const currency: Partial<Currency> = {
            code: "USD",
            name: "Eagle Feathers",
            symbol: "$",
            decimalPlaces: 2
        };

        const value: Partial<Value> = {
            id: "contact4-value",
            currency: "USD",
            balance: 0,
            contactId: contact4.id
        };

        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/currencies", "POST", currency);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const resp2 = await testUtils.testAuthedRequest<any>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp2.statusCode, 201, `create body=${JSON.stringify(resp2.body)}`);

        const resp3 = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact4.id}`, "DELETE");
        chai.assert.equal(resp3.statusCode, 409, `delete body=${JSON.stringify(resp3.body)}`);
    });

    it("can create a contact with unicode characters", async () => {
        const contact: Partial<Contact> = {
            id: "chinese-name",
            firstName: "芷若",
            lastName: "王",
            email: null,
            metadata: null
        };

        const resp1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        chai.assert.deepEqualExcluding(resp1.body, {
            ...contact,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "createdBy"]);

        const resp2 = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact.id}`, "GET", contact);
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.deepEqualExcluding(resp2.body, {
            ...contact,
            createdBy: defaultTestUser.auth.teamMemberId
        }, ["createdDate", "updatedDate", "createdBy"]);
    });

    describe("handling unicode in IDs", () => {
        it("404s getting a Contact by ID with unicode", async () => {
            const contactResp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/%F0%9F%92%A9`, "GET");
            chai.assert.equal(contactResp.statusCode, 404);
            chai.assert.equal(contactResp.body.messageCode, "ContactNotFound");
        });

        it("returns an empty list searching Contact by ID with unicode", async () => {
            const contactsResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/contacts?id=%F0%9F%92%A9", "GET");
            chai.assert.equal(contactsResp.statusCode, 200);
            chai.assert.deepEqual(contactsResp.body, []);
        });

        it("returns an empty list searching Contact by email with unicode", async () => {
            const contactsResp = await testUtils.testAuthedRequest<Value[]>(router, "/v2/contacts?email=%F0%9F%92%A9", "GET");
            chai.assert.equal(contactsResp.statusCode, 200);
            chai.assert.deepEqual(contactsResp.body, []);
        });

        it("returns valid results, when searching ID with the in operator and some values are unicode", async () => {
            const contact: Partial<Contact> = {
                id: generateId()
            };
            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);

            const contactsResp = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?id.in=%22%3E%3Cimg%20src%3D1%20onerror%3Dompt(document.cookie)%3B%3E%F0%9F%98%82,${contact.id}`, "GET");
            chai.assert.equal(contactsResp.statusCode, 200);
            chai.assert.deepEqual(contactsResp.body, [createContact.body]);
        });

        it("404s patching a Contact by ID with unicode", async () => {
            const patchResp = await testUtils.testAuthedRequest<any>(router, "/v2/contacts/%F0%9F%92%A9", "PATCH", {
                firstName: "Joey Jo-Jo Jr",
                lastName: "Shabadoo"
            });
            chai.assert.equal(patchResp.statusCode, 404);
            chai.assert.equal(patchResp.body.messageCode, "ContactNotFound");
        });

        it("404s deleting a Contact by ID with unicode", async () => {
            const deleteResp = await testUtils.testAuthedRequest<any>(router, "/v2/contacts/%F0%9F%92%A9", "DELETE");
            chai.assert.equal(deleteResp.statusCode, 404);
            chai.assert.equal(deleteResp.body.messageCode, "ContactNotFound");
        });
    });

    it("treats contactId as case sensitive", async () => {
        const contact1: Partial<Contact> = {
            id: generateId() + "-A"
        };
        const contact2: Partial<Contact> = {
            id: contact1.id.toLowerCase()
        };
        chai.assert.notEqual(contact1.id, contact2.id);

        const postContact1Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact1);
        chai.assert.equal(postContact1Resp.statusCode, 201);

        const postContact2Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact2);
        chai.assert.equal(postContact2Resp.statusCode, 201, postContact2Resp.bodyRaw);

        const getContact1Resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact1.id}`, "GET");
        chai.assert.equal(getContact1Resp.statusCode, 200);
        chai.assert.equal(getContact1Resp.body.id, contact1.id);

        const getContact2Resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact2.id}`, "GET");
        chai.assert.equal(getContact2Resp.statusCode, 200);
        chai.assert.equal(getContact2Resp.body.id, contact2.id);
        chai.assert.notEqual(getContact1Resp.body.id, getContact2Resp.body.id);

        const getContacts1Resp = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?id=${contact1.id}`, "GET");
        chai.assert.equal(getContacts1Resp.statusCode, 200);
        chai.assert.deepEqual(getContacts1Resp.body, [getContact1Resp.body]);

        const getContacts2Resp = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?id=${contact2.id}`, "GET");
        chai.assert.equal(getContacts2Resp.statusCode, 200);
        chai.assert.deepEqual(getContacts2Resp.body, [getContact2Resp.body]);
    });

    describe("filters and pagination", () => {
        const contacts: Partial<DbContact>[] = [
            {
                "id": "5b172001e2c81861deb1e277",
                "firstName": "Cohen",
                "lastName": "Parrish",
                "email": "cohenparrish@euron.com"
            },
            {
                "id": "5b1720010f83d6177bc8bf6d",
                "firstName": "Schwartz",
                "lastName": "Ewing",
                "email": "schwartzewing@euron.com"
            },
            {
                "id": "5b1720019238313f2adadc5a",
                "firstName": "Calderon",
                "lastName": "Cross",
                "email": "calderoncross@euron.com"
            },
            {
                "id": "5b17200169632e7aec32aff7",
                "firstName": "Merle",
                "lastName": "Christensen",
                "email": "merlechristensen@euron.com"
            },
            {
                "id": "5b17200194e7aafa76e7e8e3",
                "firstName": "Haley",
                "lastName": "Cochran",
                "email": "haleycochran@euron.com"
            },
            {
                "id": "5b1720011f4aae8b1698844e",
                "firstName": "Mercer",
                "lastName": "Carey",
                "email": "mercercarey@euron.com"
            },
            {
                "id": "5b1720014c4b8c0d2783fd6c",
                "firstName": "King",
                "lastName": "Whitley",
                "email": "kingwhitley@euron.com"
            },
            {
                "id": "5b1720017b95f26d247d9e44",
                "firstName": "Pacheco",
                "lastName": "Jennings",
                "email": "pachecojennings@euron.com"
            },
            {
                "id": "5b1720018b713ff73a4b17ee",
                "firstName": "Juliana",
                "lastName": "Joyce",
                "email": "julianajoyce@euron.com"
            },
            {
                "id": "5b17200148cf28ab8528c218",
                "firstName": "Nora",
                "lastName": "Noel",
                "email": "noranoel@euron.com"
            },
            {
                "id": "5b172001e4f6e06f292515ce",
                "firstName": "Faulkner",
                "lastName": "Lucas",
                "email": "faulknerlucas@euron.com"
            },
            {
                "id": "5b172001278e1d2d15c63446",
                "firstName": "Elba",
                "lastName": "Glass",
                "email": "elbaglass@euron.com"
            },
            {
                "id": "5b17200128b6be329a9f229c",
                "firstName": "Rhea",
                "lastName": "Nunez",
                "email": "rheanunez@euron.com"
            },
            {
                "id": "5b172001a09bb637a06b3d26",
                "firstName": "Audra",
                "lastName": "Houston",
                "email": "audrahouston@euron.com"
            },
            {
                "id": "5b172001a8ff3f9c3d0e0350",
                "firstName": "Lucinda",
                "lastName": "Ball",
                "email": "lucindaball@euron.com"
            },
            {
                "id": "5b17200103313ed111a58163",
                "firstName": "Lynn",
                "lastName": "Gallegos",
                "email": "lynngallegos@euron.com"
            },
            {
                "id": "5b1720017927331337f15af9",
                "firstName": "Lou",
                "lastName": "Huffman",
                "email": "louhuffman@euron.com"
            },
            {
                "id": "5b17200138ea4742dca8f1ff",
                "firstName": "Candy",
                "lastName": "Sharpe",
                "email": "candysharpe@euron.com"
            },
            {
                "id": "5b17200193583445e1b25f8f",
                "firstName": "Whitley",
                "lastName": "Higgins",
                "email": "whitleyhiggins@euron.com"
            },
            {
                "id": "5b17200191d2a319acb23984",
                "firstName": "Drake",
                "lastName": "Myers",
                "email": "drakemyers@euron.com"
            },
            {
                "id": "5b1720012cc993f45b748069",
                "firstName": "Sweeney",
                "lastName": "Garza",
                "email": "sweeneygarza@euron.com"
            },
            {
                "id": "5b172001d69c60ce68f5f840",
                "firstName": "Kenya",
                "lastName": "Sherman",
                "email": "kenyasherman@euron.com"
            },
            {
                "id": "5b172001460fdde20d4fc2f4",
                "firstName": "Angelina",
                "lastName": "Holloway",
                "email": "angelinaholloway@euron.com"
            },
            {
                "id": "5b17200112ae79a91eece2cd",
                "firstName": "Jana",
                "lastName": "Roach",
                "email": "janaroach@euron.com"
            },
            {
                "id": "5b1720019043ca64c7c74a6e",
                "firstName": "Bullock",
                "lastName": "Decker",
                "email": "bullockdecker@euron.com"
            },
            {
                "id": "5b17200188c8d04a73e9e8f1",
                "firstName": "Vasquez",
                "lastName": "Beasley",
                "email": "vasquezbeasley@euron.com"
            },
            {
                "id": "5b17200115eb658d53de9973",
                "firstName": "Ortiz",
                "lastName": "Garner",
                "email": "ortizgarner@euron.com"
            },
            {
                "id": "5b17200108604dad9a1d5bd2",
                "firstName": "Landry",
                "lastName": "Dillon",
                "email": "landrydillon@euron.com"
            },
            {
                "id": "5b172001c7a6077554941f75",
                "firstName": "Hughes",
                "lastName": "Murphy",
                "email": "hughesmurphy@euron.com"
            },
            {
                "id": "5b17200183d1501155823ffc",
                "firstName": "Lorena",
                "lastName": "Holmes",
                "email": "lorenaholmes@euron.com"
            },
            {
                "id": "5b1720018ce12bc4620fed2c",
                "firstName": "Ramona",
                "lastName": "Gutierrez",
                "email": "ramonagutierrez@euron.com"
            },
            {
                "id": "5b172001d8d7c9de10c451ed",
                "firstName": "Angela",
                "lastName": "Reese",
                "email": "angelareese@euron.com"
            },
            {
                "id": "5b1720013936e2162843a0b5",
                "firstName": "Obrien",
                "lastName": "Potter",
                "email": "obrienpotter@euron.com"
            },
            {
                "id": "5b172001417699e824197b8e",
                "firstName": "Curtis",
                "lastName": "Rios",
                "email": "curtisrios@euron.com"
            },
            {
                "id": "5b1720016529ec8fe9454374",
                "firstName": "Foreman",
                "lastName": "Conley",
                "email": "foremanconley@euron.com"
            },
            {
                "id": "5b172001cdc841b5b2534a57",
                "firstName": "Coleen",
                "lastName": "Coleman",
                "email": "coleencoleman@euron.com"
            },
            {
                "id": "5b172001875dd5c86b991a36",
                "firstName": "Gilmore",
                "lastName": "Callahan",
                "email": "gilmorecallahan@euron.com"
            },
            {
                "id": "5b172001fa9a9a810c5fdc13",
                "firstName": "Jensen",
                "lastName": "Frederick",
                "email": "jensenfrederick@euron.com"
            },
            {
                "id": "5b1720016e4d2b338f5e03f6",
                "firstName": "Pauline",
                "lastName": "Carney",
                "email": "paulinecarney@euron.com"
            },
            {
                "id": "5b172001718b653554f1745b",
                "firstName": "Wright",
                "lastName": "Watson",
                "email": "wrightwatson@euron.com"
            },
            {
                "id": "5b1720018081227fcdef04ba",
                "firstName": "Wolfe",
                "lastName": "Larson",
                "email": "wolfelarson@euron.com"
            },
            {
                "id": "5b172001ded3cca1f5a074a4",
                "firstName": "Reyna",
                "lastName": "Bowers",
                "email": "reynabowers@euron.com"
            },
            {
                "id": "5b172001f6100a7feed5f211",
                "firstName": "Buckner",
                "lastName": "Woods",
                "email": "bucknerwoods@euron.com"
            },
            {
                "id": "5b172001c11674ab723b7bf5",
                "firstName": "Barrera",
                "lastName": "Jacobs",
                "email": "barrerajacobs@euron.com"
            },
            {
                "id": "5b172001cf8fd21d9e1fec75",
                "firstName": "Marylou",
                "lastName": "Mercer",
                "email": "maryloumercer@euron.com"
            },
            {
                "id": "5b1720013a9c4720a878c698",
                "firstName": "Alyson",
                "lastName": "Sutton",
                "email": "alysonsutton@euron.com"
            },
            {
                "id": "5b172001645ca65eaf324144",
                "firstName": "Burris",
                "lastName": "Neal",
                "email": "burrisneal@euron.com"
            },
            {
                "id": "5b17200174d55f84ac7e25a2",
                "firstName": "Dianne",
                "lastName": "Hartman",
                "email": "diannehartman@euron.com"
            },
            {
                "id": "5b17200165bb4a166949e0b2",
                "firstName": "Shannon",
                "lastName": "Kerr",
                "email": "shannonkerr@euron.com"
            },
            {
                "id": "5b1720015e2667d7698a0c88",
                "firstName": "Cherie",
                "lastName": "Nelson",
                "email": "cherienelson@euron.com"
            },
            {
                "id": "5b1720010e8f5ff3a6b82a72",
                "firstName": "Baird",
                "lastName": "Pate",
                "email": "bairdpate@euron.com"
            },
            {
                "id": "5b17200117cd3b50266abbb0",
                "firstName": "Hillary",
                "lastName": "Barrera",
                "email": "hillarybarrera@euron.com"
            },
            {
                "id": "5b172001aede727262cb1ea4",
                "firstName": "Lindsay",
                "lastName": "Wood",
                "email": "lindsaywood@euron.com"
            },
            {
                "id": "5b1720012e29ffb61a5139e6",
                "firstName": "Janie",
                "lastName": "Johnson",
                "email": "janiejohnson@euron.com"
            },
            {
                "id": "5b1720010701c6f638a81d42",
                "firstName": "Knapp",
                "lastName": "Deleon",
                "email": "knappdeleon@euron.com"
            }
        ];

        before(async () => {
            for (const contact of contacts) {
                contact.userId = defaultTestUser.userId;
                contact.createdDate = new Date();
                contact.updatedDate = new Date();
                contact.createdBy = defaultTestUser.auth.teamMemberId;
            }
            const knex = await getKnexWrite();
            await knex("Contacts").insert(contacts);
        });

        it("filters and paginates through many contacts", async () => {
            const knex = await getKnexRead();
            const expected = await knex("Contacts")
                .where({
                    userId: defaultTestUser.userId
                })
                .where("firstName", "LIKE", "J%")
                .orderBy("createdDate", "desc")
                .orderBy("id", "desc");
            chai.assert.isAtLeast(expected.length, 2, "expect results");

            const page1Size = Math.ceil(expected.length / 2);
            const page1 = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?firstName.like=${encodeURIComponent("J%")}&limit=${page1Size}`, "GET");
            chai.assert.equal(page1.statusCode, 200, `body=${JSON.stringify(page1.body)}`);
            chai.assert.deepEqual(page1.body.map(c => c.id), expected.slice(0, page1Size).map(c => c.id), "the same ids in the same order");
            chai.assert.equal(page1.headers["Limit"], `${page1Size}`);
            chai.assert.equal(page1.headers["Max-Limit"], "1000");
            chai.assert.isDefined(page1.headers["Link"]);

            const page1Link = parseLinkHeader(page1.headers["Link"]);
            const page2 = await testUtils.testAuthedRequest<Contact[]>(router, page1Link.next.url, "GET");
            chai.assert.equal(page2.statusCode, 200, `url=${page1Link.next.url} body=${JSON.stringify(page2.body)}`);
            chai.assert.deepEqual(page2.body.map(c => c.id), expected.slice(page1Size).map(c => c.id), "the same ids in the same order");
            chai.assert.equal(page1.headers["Limit"], `${page1Size}`);
            chai.assert.equal(page1.headers["Max-Limit"], "1000");
            chai.assert.isDefined(page1.headers["Link"]);

            const page2Link = parseLinkHeader(page2.headers["Link"]);
            const page2prev = await testUtils.testAuthedRequest<Contact[]>(router, page2Link.prev.url, "GET");
            chai.assert.equal(page2prev.statusCode, 200, `url=${page2Link.prev.url} body=${JSON.stringify(page2prev.body)}`);
            chai.assert.deepEqual(page2prev.body, page1.body);
        });

        it("supports id.in", async () => {
            const ids = ["5b172001f6100a7feed5f211", "5b17200193583445e1b25f8f", "5b1720010f83d6177bc8bf6d", "5b172001460fdde20d4fc2f4"];

            const knex = await getKnexRead();
            const expected = await knex("Contacts")
                .where({
                    userId: defaultTestUser.userId
                })
                .whereIn("id", ids)
                .orderBy("createdDate", "desc")
                .orderBy("id", "desc");

            const page1 = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?id.in=${ids.join(",")}`, "GET");
            chai.assert.equal(page1.statusCode, 200, `body=${JSON.stringify(page1.body)}`);
            chai.assert.deepEqualExcludingEvery<any>(page1.body, expected, ["userId", "createdDate", "updatedDate"]);
            chai.assert.isDefined(page1.headers["Link"]);
        });
    });

    describe("userId isolation", () => {
        it("doesn't leak /contacts", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/contacts", "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
            chai.assert.deepEqual(JSON.parse(resp.body), []);
            chai.assert.equal(resp.headers["Limit"], "100");
            chai.assert.equal(resp.headers["Max-Limit"], "1000");
        });

        it("doesn't leak GET /contacts/{id}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/contacts/${contact1.id}`, "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 404, `body=${JSON.stringify(resp.body)}`);
        });

        it("doesn't leak PUT /contacts/{id}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/contacts/${contact1.id}`, "PUT", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                },
                body: JSON.stringify(contact1)
            }));
            chai.assert.equal(resp.statusCode, 404, `body=${JSON.stringify(resp.body)}`);
        });
    });

    it(`default sorting createdDate`, async () => {
        const idAndDates = [
            {id: generateId(), createdDate: new Date("3030-02-01")},
            {id: generateId(), createdDate: new Date("3030-02-02")},
            {id: generateId(), createdDate: new Date("3030-02-03")},
            {id: generateId(), createdDate: new Date("3030-02-04")}
        ];
        for (const idAndDate of idAndDates) {
            const response = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
                id: idAndDate.id,
                email: "user@example.com"
            });
            chai.assert.equal(response.statusCode, 201);
            const knex = await getKnexWrite();
            const res: number = await knex("Contacts")
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: idAndDate.id,
                })
                .update(Contact.toDbContact(testUtils.defaultTestUser.auth, {
                    ...response.body,
                    createdDate: idAndDate.createdDate,
                    updatedDate: idAndDate.createdDate
                }));
            if (res === 0) {
                chai.assert.fail(`no row updated. test is broken`);
            }
        }
        const resp = await testUtils.testAuthedRequest<Contact[]>(router, "/v2/contacts?createdDate.gt=3030-01-01", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.equal(resp.body.length, 4);
        chai.assert.sameOrderedMembers(resp.body.map(tx => tx.id), idAndDates.reverse().map(tx => tx.id) /* reversed since createdDate desc */);
    });

    it("can create contact with maximum id length", async () => {
        const contact: Partial<Contact> = {
            id: generateId(64)
        };
        chai.assert.equal(contact.id.length, 64);

        const createContact = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", contact);
        chai.assert.equal(createContact.statusCode, 201);
        chai.assert.equal(createContact.body.id, contact.id);
    });

    it("cannot create contact with id exceeding max length of 64 - returns 422", async () => {
        const contact: Partial<Contact> = {
            id: generateId(65)
        };
        chai.assert.equal(contact.id.length, 65);

        const createContact = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/contacts`, "POST", contact);
        chai.assert.equal(createContact.statusCode, 422);
        chai.assert.include(createContact.body.message, "requestBody.id does not meet maximum length of 64");
    });

    describe("whitespace handling", () => {
        it("422s creating contactIds with leading/trailing whitespace", async () => {
            const contactLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/contacts", "POST", {
                id: `\t${testUtils.generateId()}`
            });
            chai.assert.equal(contactLeadingResp.statusCode, 422, `contactLeadingResp.body=${JSON.stringify(contactLeadingResp.body)}`);
            const contactTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/contacts", "POST", {
                id: `${testUtils.generateId()}\n`
            });
            chai.assert.equal(contactTrailingResp.statusCode, 422, `contactTrailingResp.body=${JSON.stringify(contactTrailingResp.body)}`);
        });

        it("404s when looking up a contact by id with leading/trailing whitespace", async () => {
            const contactId = testUtils.generateId();
            const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp.body)}`);

            const fetchLeading = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/%20${contactId}`, "GET");
            chai.assert.equal(fetchLeading.statusCode, 404, `fetchLeading.body=${JSON.stringify(fetchLeading.body)}`);
            const fetchTrailing = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contactId}%20`, "GET");
            chai.assert.equal(fetchTrailing.statusCode, 404, `fetchTrailing.body=${JSON.stringify(fetchTrailing.body)}`);
        });

        describe("FK references to contactIds", () => {
            let contactForFKReferences: Contact;

            before(async () => {
                const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
                    id: testUtils.generateId()
                });
                chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp.body)}`);
                contactForFKReferences = contactResp.body;
            });

            it("404s attaching values to contactIds with leading/trailing whitespace", async () => {
                const attachLeadingResp = await testUtils.testAuthedRequest<GiftbitRestError>(router, `/v2/contacts/%20${contactForFKReferences.id}/values/attach`, "POST", {
                    valueId: "irrelevant"
                });
                chai.assert.equal(attachLeadingResp.statusCode, 404, `attachLeadingResp.body=${JSON.stringify(attachLeadingResp.body)}`);
                chai.assert.equal(attachLeadingResp.body["messageCode"], "ContactNotFound", `attachLeadingResp.body=${JSON.stringify(attachLeadingResp.body)}`);
                const attachTrailingResp = await testUtils.testAuthedRequest<GiftbitRestError>(router, `/v2/contacts/${contactForFKReferences.id}%0D%0A/values/attach`, "POST", {
                    valueId: "irrelevant"
                });
                chai.assert.equal(attachTrailingResp.statusCode, 404, `attachTrailingResp.body=${JSON.stringify(attachTrailingResp.body)}`);
                chai.assert.equal(attachTrailingResp.body["messageCode"], "ContactNotFound", `attachTrailingResp.body=${JSON.stringify(attachTrailingResp.body)}`);
            });

            it("409s transacting against contactIds (checkout only) with leading/trailing whitespace", async () => {
                await testUtils.createUSDValue(router, {contactId: contactForFKReferences.id}); // 'contact not found' is indistinguishable from 'contact has no attached values' in checkout failures
                const txLeadingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD",
                    lineItems: [{unitPrice: 1}],
                    sources: [{
                        rail: "lightrail",
                        contactId: ` ${contactForFKReferences.id}`
                    }]
                });
                chai.assert.equal(txLeadingResp.statusCode, 409, `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);
                chai.assert.equal(txLeadingResp.body["messageCode"], "InsufficientBalance", `txLeadingResp.body=${JSON.stringify(txLeadingResp.body)}`);
                const txTrailingResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                    id: testUtils.generateId(),
                    currency: "USD",
                    lineItems: [{unitPrice: 1}],
                    sources: [{
                        rail: "lightrail",
                        contactId: `${contactForFKReferences.id}\n`
                    }]
                });
                chai.assert.equal(txTrailingResp.statusCode, 409, `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
                chai.assert.equal(txTrailingResp.body["messageCode"], "InsufficientBalance", `txTrailingResp.body=${JSON.stringify(txTrailingResp.body)}`);
            });

            it("does not find values when searching by contactId with leading/trailing whitespace", async () => {
                await testUtils.createUSDValue(router, {contactId: contactForFKReferences.id});

                const fetchLeadingResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=%20${contactForFKReferences.id}`, "GET");
                chai.assert.equal(fetchLeadingResp.statusCode, 200, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                chai.assert.equal(fetchLeadingResp.body.length, 0, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);

                const fetchTrailingResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contactForFKReferences.id}%20`, "GET");
                chai.assert.equal(fetchTrailingResp.statusCode, 200, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
                chai.assert.equal(fetchTrailingResp.body.length, 0, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
            });

            it("does not find transactions when searching by contactId with leading/trailing whitespace", async () => {
                await testUtils.createUSDValue(router, {balance: 1000, contactId: contactForFKReferences.id});
                await testUtils.createUSDCheckout(router, {
                    sources: [{
                        rail: "lightrail",
                        contactId: contactForFKReferences.id
                    }]
                }, false);

                const fetchLeadingResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?contactId=%20${contactForFKReferences.id}`, "GET");
                chai.assert.equal(fetchLeadingResp.statusCode, 200, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);
                chai.assert.equal(fetchLeadingResp.body.length, 0, `fetchLeadingResp.body=${JSON.stringify(fetchLeadingResp.body)}`);

                const fetchTrailingResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?contactId=${contactForFKReferences.id}%20`, "GET");
                chai.assert.equal(fetchTrailingResp.statusCode, 200, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
                chai.assert.equal(fetchTrailingResp.body.length, 0, `fetchTrailingResp.body=${JSON.stringify(fetchTrailingResp.body)}`);
            });
        });
    });
});

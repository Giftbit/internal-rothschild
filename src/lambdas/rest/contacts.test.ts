import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../testUtils";
import {Contact} from "../../model/Contact";
import {installRest} from "./index";

chai.use(require("chai-exclude"));

describe("/v2/contacts", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);
    });

    it("can list 0 contacts", async () => {
        const resp = await testUtils.testAuthedRequest<Contact[]>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can list 0 contacts with csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
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
        chai.assert.deepEqualExcluding(resp.body, contact1, ["createdDate", "updatedDate", "metadata"]);
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
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can list 1 contact in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            contact1
        ], ["createdDate", "updatedDate"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("requires an id to create a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            ...contact1,
            id: undefined
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
            email: null
        }, ["createdDate", "updatedDate", "metadata"]);
        chai.assert.equal(resp.statusCode, 201);
        contact2 = resp.body;
    });

    let contact3: Partial<Contact> & {userId: string} = {
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

    it("409s on creating a duplicate contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact1.id, firstName: "Duplicate"});
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
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
        chai.assert.deepEqual(resp.body, [
            contact1,
            contact2
        ]);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can list 2 contacts in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            contact1,
            contact2
        ], ["createdDate", "updatedDate"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can page to the second contact", async () => {
        const resp = await testUtils.testAuthedRequest<Contact[]>(router, "/v2/contacts?limit=1&offset=1", "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, [
            contact2
        ]);
        chai.assert.equal(resp.headers["Limit"], "1");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "1");
    });

    it("can page to the second contact in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Contact>(router, "/v2/contacts?limit=1&offset=1", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            contact2
        ], ["createdDate", "updatedDate"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "1");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "1");
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
            email: null
        }, ["createdDate", "updatedDate"]);
        contact4 = resp.body;
    });

    it("can get the contact with metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact4.id}`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, contact4);
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
            chai.assert.equal(resp.headers["MaxLimit"], "1000");
            chai.assert.equal(resp.headers["Offset"], "0");
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
});

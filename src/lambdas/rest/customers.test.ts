import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as testUtils from "../../testUtils";
import {Customer} from "../../model/Customer";
import {installRest} from "./index";

chai.use(require("chai-exclude"));

describe("/v2/customers", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        installRest(router);
    });

    it("can list 0 customers", async () => {
        const resp = await testUtils.testAuthedRequest<Customer[]>(router, "/v2/customers", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can list 0 customers with csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Customer>(router, "/v2/customers", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, []);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    let customer1: Partial<Customer> = {
        customerId: "c1",
        firstName: "First",
        lastName: "Last",
        email: "email@example.com"
    };

    it("can create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", customer1);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.deepEqualExcluding(resp.body, customer1, ["createdDate", "updatedDate", "metadata"]);
        customer1 = resp.body;
    });

    it("can get the customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, `/v2/customers/${customer1.customerId}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, customer1);
    });

    it("can list 1 customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer[]>(router, "/v2/customers", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, [
            customer1
        ]);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can list 1 customer in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Customer>(router, "/v2/customers", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            customer1
        ], ["createdDate", "updatedDate"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("requires a customerId to create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", {
            ...customer1,
            customerId: undefined
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires a string customerId to create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", {
            ...customer1,
            customerId: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires firstName is a string to create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", {
            ...customer1,
            firstName: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires lastName is a string to create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", {
            ...customer1,
            lastName: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    it("requires email is a string to create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", {
            ...customer1,
            email: 123
        });
        chai.assert.equal(resp.statusCode, 422);
    });

    let customer2: Partial<Customer> = {
        customerId: "c2"
    };

    it("only requires customerId to create a customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", customer2);
        chai.assert.deepEqualExcluding(resp.body, {
            ...customer2,
            firstName: null,
            lastName: null,
            email: null
        }, ["createdDate", "updatedDate", "metadata"]);
        chai.assert.equal(resp.statusCode, 201);
        customer2 = resp.body;
    });

    let customer3: Partial<Customer> & {userId: string} = {
        customerId: "c3",
        userId: "malicious"
    };

    it("can't override the userId", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, "/v2/customers", "POST", customer3);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.notEqual(resp.body.userId, customer3.userId);
        customer3 = resp.body;
    });

    it("can modify the customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, `/v2/customers/${customer1.customerId}`, "PATCH", {
            firstName: customer1.firstName = "Customer",
            lastName: customer1.lastName = "One"
        });
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.deepEqual(resp.body, customer1);

        const getResp = await testUtils.testAuthedRequest<Customer>(router, `/v2/customers/${customer1.customerId}`, "GET");
        chai.assert.equal(getResp.statusCode, 200);
        chai.assert.deepEqual(getResp.body, customer1);
    });

    it("409s on creating a duplicate customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", customer1);
        chai.assert.equal(resp.statusCode, 409);
    });

    it("404s on getting invalid customerId", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, `/v2/customers/iamnotavalidcustomerid`, "GET");
        chai.assert.equal(resp.statusCode, 404);
    });

    it("404s on modifying invalid customerId", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, `/v2/customers/iamnotavalidcustomerid`, "PUT", customer1);
        chai.assert.equal(resp.statusCode, 404);
    });

    it("can list 3 customers", async () => {
        const resp = await testUtils.testAuthedRequest<Customer[]>(router, "/v2/customers", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, [
            customer1,
            customer2,
            customer3
        ]);
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can list 3 customers in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Customer>(router, "/v2/customers", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            customer1,
            customer2,
            customer3
        ], ["createdDate", "updatedDate"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "100");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "0");
    });

    it("can page to the second customer", async () => {
        const resp = await testUtils.testAuthedRequest<Customer[]>(router, "/v2/customers?limit=1&offset=1", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, [
            customer2
        ]);
        chai.assert.equal(resp.headers["Limit"], "1");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "1");
    });

    it("can page to the second customer in csv", async () => {
        const resp = await testUtils.testAuthedCsvRequest<Customer>(router, "/v2/customers?limit=1&offset=1", "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqualExcludingEvery(resp.body, [
            customer2
        ], ["createdDate", "updatedDate"]); // TODO don't ignore dates if my issue gets resolved https://github.com/mholt/PapaParse/issues/502
        chai.assert.equal(resp.headers["Limit"], "1");
        chai.assert.equal(resp.headers["MaxLimit"], "1000");
        chai.assert.equal(resp.headers["Offset"], "1");
    });

    let customer4: Partial<Customer> = {
        customerId: "c4",
        firstName: "customer4",
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

    it("can create a customer with metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, "/v2/customers", "POST", customer4);
        chai.assert.equal(resp.statusCode, 201);
        chai.assert.deepEqualExcluding(resp.body, {
            ...customer4,
            lastName: null,
            email: null
        }, ["createdDate", "updatedDate"]);
        customer4 = resp.body;
    });

    it("can get the customer with metadata", async () => {
        const resp = await testUtils.testAuthedRequest<Customer>(router, `/v2/customers/${customer4.customerId}`, "GET");
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(resp.body, customer4);
    });

    describe("userId isolation", () => {
        it("doesn't leak /customers", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.deepEqual(JSON.parse(resp.body), []);
            chai.assert.equal(resp.headers["Limit"], "100");
            chai.assert.equal(resp.headers["MaxLimit"], "1000");
            chai.assert.equal(resp.headers["Offset"], "0");
        });

        it("doesn't leak GET /customer/{customerId}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/${customer1.customerId}`, "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 404);
        });

        it("doesn't leak PUT /customer/{customerId}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/${customer1.customerId}`, "PUT", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                },
                body: JSON.stringify(customer1)
            }));
            chai.assert.equal(resp.statusCode, 404);
        });
    });
});

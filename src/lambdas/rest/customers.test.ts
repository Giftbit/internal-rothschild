import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as customers from "./customers";
import * as testUtils from "../../testUtils";

describe("/v2/customers/", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        customers.installCustomersRest(router);
    });

    it("can list 0 customers", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), {
            customers: [],
            pagination: {
                count: 0,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });

    const customer1: any = {
        customerId: "1",
        firstName: "First",
        lastName: "Last",
        email: "email@example.com"
    };

    it("can create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(customer1)
        }));
        customer1.userId = testUtils.testUserA.userId;

        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), customer1);
    });

    it("can get the customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/${customer1.customerId}`, "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), customer1);
    });

    it("can list 1 customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), {
            customers: [
                customer1
            ],
            pagination: {
                count: 1,
                limit: 100,
                maxLimit: 1000,
                offset: 0
            }
        });
    });
    
    it("requires a customerId to create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                ...customer1,
                customerId: undefined
            })
        }));
        chai.assert.equal(resp.statusCode, 409);
    });
    
    it("requires a string customerId to create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                ...customer1,
                customerId: 123
            })
        }));
        chai.assert.equal(resp.statusCode, 409);
    });
    
    it("requires firstName is a string to create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                ...customer1,
                firstName: 123
            })
        }));
        chai.assert.equal(resp.statusCode, 409);
    });
    
    it("requires lastName is a string to create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                ...customer1,
                lastName: 123
            })
        }));
        chai.assert.equal(resp.statusCode, 409);
    });
    
    it("requires email is a string to create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify({
                ...customer1,
                email: 123
            })
        }));
        chai.assert.equal(resp.statusCode, 409);
    });
    
    const customer2: any = {
        customerId: "2"
    };
    
    it("only requires customerId to create a customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(customer2)
        }));
        customer2.userId = testUtils.testUserA.userId;
        
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), customer2);
    });
    
    const customer3: any = {
        customerId: "3",
        userId: "malicious"
    };
    
    it("doesn't allow the user to set the userId", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "POST", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(customer3)
        }));
        
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.notDeepEqual(JSON.parse(resp.body), customer3);
        chai.assert.equal(JSON.parse(resp.body).userId, testUtils.testUserA.userId);
    });

    it("can modify the customer", async () => {
        customer1.firstName = "Customer";
        customer1.lastName = "One";

        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/${customer1.customerId}`, "PUT", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(customer1)
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), customer1);
    });

    it("404s on getting invalid customerId", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/iamnotavalidcustomerid`, "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 404);
    });

    it("404s on modifying invalid customerId", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/iamnotavalidcustomerid`, "PUT", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            },
            body: JSON.stringify(customer1)
        }));
        chai.assert.equal(resp.statusCode, 404);
    });

    it("can page to the second customer", async () => {
        const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers?limit=1&offset=1", "GET", {
            headers: {
                Authorization: `Bearer ${testUtils.testUserA.jwt}`
            }
        }));
        chai.assert.equal(resp.statusCode, 200);
        chai.assert.deepEqual(JSON.parse(resp.body), {
            customers: [
                customer2
            ],
            pagination: {
                count: 1,
                limit: 1,
                maxLimit: 1000,
                offset: 1
            }
        });
    });

    describe("userId isolation", () => {
        it("doesn't leak /customers", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/customers", "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserB.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 200);
            chai.assert.deepEqual(JSON.parse(resp.body), {
                customers: [],
                pagination: {
                    count: 0,
                    limit: 100,
                    maxLimit: 1000,
                    offset: 0
                }
            });
        });

        it("doesn't leak GET /customer/{customerId}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/${customer1.customerId}`, "GET", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserB.jwt}`
                }
            }));
            chai.assert.equal(resp.statusCode, 404);
        });

        it("doesn't leak PUT /customer/{customerId}", async () => {
            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/customers/${customer1.customerId}`, "PUT", {
                headers: {
                    Authorization: `Bearer ${testUtils.testUserB.jwt}`
                },
                body: JSON.stringify(customer1)
            }));
            chai.assert.equal(resp.statusCode, 404);
        });
    });
});

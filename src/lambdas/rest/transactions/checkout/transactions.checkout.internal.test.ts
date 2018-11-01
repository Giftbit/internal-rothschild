import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../../utils/testUtils";
import {defaultTestUser, generateId} from "../../../../utils/testUtils";
import {Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import {installRestRoutes} from "../../installRestRoutes";
import chaiExclude = require("chai-exclude");
import {Value} from "../../../../model/Value";

chai.use(chaiExclude);

describe("/v2/transactions/checkout - internal sources", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "CAD",
            name: "Canadian Tire Money",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("checkout with single internal source", async () => {
        const request = {
            id: generateId(),
            sources: [
                {
                    rail: "internal",
                    balance: 4000,
                    internalId: generateId()
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "guacamole",
                    unitPrice: 422,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "cream-18%",
                    unitPrice: 399,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "chips-and-dips-deluxe",
                    unitPrice: 629,
                    taxRate: 0.05,
                    quantity: 2
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 2079,
                "tax": 104,
                "discount": 0,
                "discountLightrail": 0,
                "payable": 2183,
                "paidInternal": 2183,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "chips-and-dips-deluxe",
                    "unitPrice": 629,
                    "taxRate": 0.05,
                    "quantity": 2,
                    "lineTotal": {
                        "subtotal": 1258,
                        "taxable": 1258,
                        "tax": 63,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 1321
                    }
                },
                {
                    "type": "product",
                    "productId": "guacamole",
                    "unitPrice": 422,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 422,
                        "taxable": 422,
                        "tax": 21,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 443
                    }
                },
                {
                    "type": "product",
                    "productId": "cream-18%",
                    "unitPrice": 399,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 399,
                        "taxable": 399,
                        "tax": 20,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 419
                    }
                }
            ],
            "steps": [
                {
                    "rail": "internal",
                    "internalId": request.sources[0].internalId,
                    "balanceBefore": 4000,
                    "balanceAfter": 1817,
                    "balanceChange": -2183
                }
            ],
            "paymentSources": [
                {
                    "rail": "internal",
                    "balance": 4000,
                    "internalId": request.sources[0].internalId
                }
            ],
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);
    });

    it("checkout with two internal sources", async () => {
        const request = {
            id: generateId(),
            sources: [
                {
                    rail: "internal",
                    balance: 15000,
                    internalId: generateId()
                },
                {
                    rail: "internal",
                    balance: 4400,
                    internalId: generateId()
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "guacamole",
                    unitPrice: 591,
                    quantity: 20,
                    taxRate: 0.07
                },
                {
                    type: "product",
                    productId: "cream-18%",
                    unitPrice: 399,
                    quantity: 5,
                    taxRate: 0.07
                },
                {
                    type: "product",
                    productId: "chips-and-dips-deluxe",
                    unitPrice: 442,
                    taxRate: 0.07,
                    quantity: 5
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 16025,
                "tax": 1122,
                "discount": 0,
                "discountLightrail": 0,
                "payable": 17147,
                "paidInternal": 17147,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "guacamole",
                    "unitPrice": 591,
                    "quantity": 20,
                    "taxRate": 0.07,
                    "lineTotal": {
                        "subtotal": 11820,
                        "taxable": 11820,
                        "tax": 827,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 12647
                    }
                },
                {
                    "type": "product",
                    "productId": "chips-and-dips-deluxe",
                    "unitPrice": 442,
                    "taxRate": 0.07,
                    "quantity": 5,
                    "lineTotal": {
                        "subtotal": 2210,
                        "taxable": 2210,
                        "tax": 155,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 2365
                    }
                },
                {
                    "type": "product",
                    "productId": "cream-18%",
                    "unitPrice": 399,
                    "quantity": 5,
                    "taxRate": 0.07,
                    "lineTotal": {
                        "subtotal": 1995,
                        "taxable": 1995,
                        "tax": 140,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 2135
                    }
                }
            ],
            "steps": [
                {
                    "rail": "internal",
                    "internalId": request.sources[0].internalId,
                    "balanceBefore": 15000,
                    "balanceAfter": 0,
                    "balanceChange": -15000
                },
                {
                    "rail": "internal",
                    "internalId": request.sources[1].internalId,
                    "balanceBefore": 4400,
                    "balanceAfter": 2253,
                    "balanceChange": -2147
                }
            ],
            "paymentSources": [
                {
                    "rail": "internal",
                    "balance": 15000,
                    "internalId": request.sources[0].internalId
                },
                {
                    "rail": "internal",
                    "balance": 4400,
                    "internalId": request.sources[1].internalId
                }
            ],
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["steps"]);
        chai.assert.includeDeepMembers(getCheckoutResp.body.steps, postCheckoutResp.body.steps);
    });

    it("checkout with pretax and postTax internal source", async () => {
        const request = {
            id: generateId(),
            sources: [
                {
                    rail: "internal",
                    balance: 2000,
                    internalId: generateId()
                },
                {
                    rail: "internal",
                    balance: 6000,
                    internalId: generateId(),
                    pretax: true
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "guacamole",
                    unitPrice: 591,
                    taxRate: 0.05
                },
                {
                    type: "product",
                    productId: "cream-18%",
                    unitPrice: 491,
                    quantity: 2,
                    taxRate: 0.05
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 1573,
                "tax": 0,
                "discount": 0,
                "discountLightrail": 0,
                "payable": 1573,
                "paidInternal": 1573,
                "paidLightrail": 0,
                "paidStripe": 0,
                "remainder": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "cream-18%",
                    "unitPrice": 491,
                    "quantity": 2,
                    "taxRate": 0.05,
                    "lineTotal": {
                        "subtotal": 982,
                        "taxable": 0,
                        "tax": 0,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 982
                    }
                },
                {
                    "type": "product",
                    "productId": "guacamole",
                    "unitPrice": 591,
                    "taxRate": 0.05,
                    "quantity": 1,
                    "lineTotal": {
                        "subtotal": 591,
                        "taxable": 0,
                        "tax": 0,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 591
                    }
                }
            ],
            "steps": [
                {
                    "rail": "internal",
                    "internalId": request.sources[1].internalId,
                    "balanceBefore": 6000,
                    "balanceAfter": 4427,
                    "balanceChange": -1573
                }
            ],
            "paymentSources": [
                {
                    "rail": "internal",
                    "balance": 2000,
                    "internalId": request.sources[0].internalId
                },
                {
                    "rail": "internal",
                    "balance": 6000,
                    "internalId": request.sources[1].internalId,
                    "pretax": true
                }
            ],
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["steps"]);
        chai.assert.includeDeepMembers(getCheckoutResp.body.steps, postCheckoutResp.body.steps);
    });

    it("respects beforeLightrail", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "CAD",
            balance: 2000
        };
        const postValueResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValueResp.statusCode, 201, `body=${JSON.stringify(postValueResp.body)}`);

        const request = {
            id: generateId(),
            sources: [
                {
                    rail: "lightrail",
                    valueId: value.id
                },
                {
                    rail: "internal",
                    balance: 300,
                    internalId: generateId(),
                    beforeLightrail: true
                }
            ],
            lineItems: [
                {
                    type: "product",
                    productId: "salsa",
                    unitPrice: 499,
                    taxRate: 0.05
                }
            ],
            currency: "CAD"
        };
        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(postCheckoutResp.body, {
            "id": request.id,
            "transactionType": "checkout",
            "currency": "CAD",
            "totals": {
                "subtotal": 499,
                "tax": 25,
                "discount": 0,
                "discountLightrail": 0,
                "payable": 524,
                "paidInternal": 300,
                "paidLightrail": 224,
                "paidStripe": 0,
                "remainder": 0
            },
            "lineItems": [
                {
                    "type": "product",
                    "productId": "salsa",
                    "unitPrice": 499,
                    "quantity": 1,
                    "taxRate": 0.05,
                    "lineTotal": {
                        "subtotal": 499,
                        "taxable": 499,
                        "tax": 25,
                        "discount": 0,
                        "remainder": 0,
                        "payable": 524
                    }
                }
            ],
            "steps": [
                {
                    "rail": "internal",
                    "internalId": request.sources[1].internalId,
                    "balanceBefore": 300,
                    "balanceAfter": 0,
                    "balanceChange": -300
                },
                {
                    "rail": "lightrail",
                    "valueId": value.id,
                    "balanceBefore": 2000,
                    "balanceAfter": 1776,
                    "balanceChange": -224,
                    "code": null,
                    "contactId": null,
                    "usesRemainingBefore": null,
                    "usesRemainingAfter": null,
                    "usesRemainingChange": null
                }
            ],
            "paymentSources": [
                {
                    "rail": "lightrail",
                    "valueId": value.id
                },
                {
                    "rail": "internal",
                    "balance": 300,
                    "internalId": request.sources[1].internalId,
                    "beforeLightrail": true
                }
            ],
            "metadata": null,
            tax: {
                "roundingMode": "HALF_EVEN"
            },
            "createdDate": null,
            "createdBy": defaultTestUser.auth.teamMemberId
        }, ["createdDate"]);
        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.deepEqualExcluding(getCheckoutResp.body, postCheckoutResp.body, ["steps"]);
        chai.assert.includeDeepMembers(getCheckoutResp.body.steps, postCheckoutResp.body.steps);
    });
});

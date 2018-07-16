import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as transactions from "../transactions";
import * as valueStores from "../../values";
import * as testUtils from "../../../../utils/testUtils";
import {generateId} from "../../../../utils/testUtils";
import {Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";

describe("/v2/transactions/checkout - internal sources", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(new giftbitRoutes.jwtauth.JwtAuthorizationRoute(Promise.resolve({secretkey: "secret"})));
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
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
                "payable": 2183,
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
            "createdDate": null
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
                "payable": 17147,
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
            "createdDate": null
        }, ["createdDate"]);
        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);
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
                "payable": 1573,
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
            "createdDate": null
        }, ["createdDate"]);
        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.deepEqual(getCheckoutResp.body, postCheckoutResp.body);
    });
});

import * as cassava from "cassava";
import * as chai from "chai";
import * as transactions from "../transactions";
import * as valueStores from "../../values";
import * as testUtils from "../../../../utils/testUtils";
import {generateId} from "../../../../utils/testUtils";
import {Transaction} from "../../../../model/Transaction";
import {createCurrency} from "../../currencies";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/transactions/checkout - allowRemainder tests", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        transactions.installTransactionsRest(router);
        valueStores.installValuesRest(router);
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("rounding HALF_UP", async () => {
        let request: any = {
            id: generateId(),
            allowRemainder: true,
            sources: [],
            tax: {
                roundingMode: "HALF_UP"
            },
            lineItems: [
                {
                    type: "product",
                    unitPrice: 1,
                    quantity: 1,
                    taxRate: 0.50
                },
                {
                    type: "product",
                    unitPrice: 3,
                    quantity: 1,
                    taxRate: 0.50
                }
            ],
            currency: "CAD"
        };
        const checkoutResponse = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(checkoutResponse.statusCode, 201, `body=${JSON.stringify(checkoutResponse.body)}`);
        chai.assert.deepEqualExcluding(checkoutResponse.body, {
            id: request.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                discount: 0,
                payable: 7,
                remainder: 7,
                subtotal: 4,
                tax: 3
            },
            lineItems: [
                {
                    "type": "product",
                    "unitPrice": 3,
                    "quantity": 1,
                    "taxRate": 0.5,
                    "lineTotal": {
                        "subtotal": 3,
                        "taxable": 3,
                        "tax": 2,
                        "discount": 0,
                        "remainder": 5,
                        "payable": 5
                    }
                },
                {
                    "type": "product",
                    "unitPrice": 1,
                    "quantity": 1,
                    "taxRate": 0.5,
                    "lineTotal": {
                        "subtotal": 1,
                        "taxable": 1,
                        "tax": 1,
                        "discount": 0,
                        "remainder": 2,
                        "payable": 2
                    }
                }
            ],
            steps: [],
            paymentSources: [],
            metadata: null,
            tax: {
                roundingMode: "HALF_UP"
            },
            createdDate: null
        }, ["createdDate"]);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, checkoutResponse.body, "statusCode");
    });

    it("rounding HALF_EVEN", async () => {
        let request: any = {
            id: generateId(),
            allowRemainder: true,
            sources: [],
            tax: {
                roundingMode: "HALF_EVEN"
            },
            lineItems: [
                {
                    type: "product",
                    unitPrice: 1,
                    quantity: 1,
                    taxRate: 0.50
                },
                {
                    type: "product",
                    unitPrice: 3,
                    quantity: 1,
                    taxRate: 0.50
                }
            ],
            currency: "CAD"
        };
        const checkoutResponse = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(checkoutResponse.statusCode, 201, `body=${JSON.stringify(checkoutResponse.body)}`);
        chai.assert.deepEqualExcluding(checkoutResponse.body, {
            id: request.id,
            transactionType: "checkout",
            currency: "CAD",
            totals: {
                discount: 0,
                payable: 6,
                remainder: 6,
                subtotal: 4,
                tax: 2
            },
            lineItems: [
                {
                    "type": "product",
                    "unitPrice": 3,
                    "quantity": 1,
                    "taxRate": 0.5,
                    "lineTotal": {
                        "subtotal": 3,
                        "taxable": 3,
                        "tax": 2, // 1.5 rounds up using HALF_EVEN
                        "discount": 0,
                        "remainder": 5,
                        "payable": 5
                    }
                },
                {
                    "type": "product",
                    "unitPrice": 1,
                    "quantity": 1,
                    "taxRate": 0.5,
                    "lineTotal": {
                        "subtotal": 1,
                        "taxable": 1,
                        "tax": 0, // 0.5 rounds down using HALF_EVEN
                        "discount": 0,
                        "remainder": 1,
                        "payable": 1
                    }
                }
            ],
            steps: [],
            paymentSources: [],
            metadata: null,
            tax: {
                roundingMode: "HALF_EVEN"
            },
            createdDate: null
        }, ["createdDate"]);

        const getCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${request.id}`, "GET");
        chai.assert.equal(getCheckoutResp.statusCode, 200, `body=${JSON.stringify(getCheckoutResp.body)}`);
        chai.assert.deepEqualExcluding(getCheckoutResp.body, checkoutResponse.body, "statusCode");
    });

    it("invalid rounding mode", async () => {
        let request: any = {
            id: generateId(),
            allowRemainder: true,
            sources: [],
            tax: {
                roundingMode: "INVALID"
            },
            lineItems: [
                {
                    type: "product",
                    unitPrice: 1,
                    quantity: 1,
                    taxRate: 0.499
                }
            ],
            currency: "CAD"
        };
        const checkoutResponse = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", request);
        chai.assert.equal(checkoutResponse.statusCode, 422, `body=${JSON.stringify(checkoutResponse.body)}`);
        chai.assert.include(checkoutResponse.body.message, "not one of enum values: HALF_EVEN,HALF_UP");
    });
});

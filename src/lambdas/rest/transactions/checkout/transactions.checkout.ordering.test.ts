import * as chai from "chai";
import * as cassava from "cassava";
import * as testUtils from "../../../../utils/testUtils";
import {generateId} from "../../../../utils/testUtils";
import {createCurrency} from "../../currencies";
import {LineItem} from "../../../../model/LineItem";
import {Value} from "../../../../model/Value";
import {installRestRoutes} from "../../installRestRoutes";
import {LightrailTransactionStep, Transaction} from "../../../../model/Transaction";

describe("/v2/transactions/checkout - lightrail ordering", () => {

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

    async function testTransactionOrder({lineItems, orderedValues}: { lineItems: LineItem[], orderedValues: Partial<Value>[] }): Promise<void> {
        const transactionId = generateId();
        for (let valueIx = 0; valueIx < orderedValues.length; valueIx++) {
            const value = orderedValues[valueIx];
            value.id = `${transactionId}-${valueIx}`;
            value.currency = "CAD";
            const createValueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueRes.statusCode, 201, `body=${JSON.stringify(createValueRes.body)}`);
        }

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
            id: transactionId,
            sources: orderedValues.map(value => ({
                rail: "lightrail",
                valueId: value.id
            })).reverse(),      // reverse the order so the checkout Transaction can't cheat
            lineItems: lineItems,
            currency: "CAD"
        });
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);

        chai.assert.equal(postCheckoutResp.body.steps.length, orderedValues.length, "transaction has the expected number of steps");
        for (let stepIx = 0; stepIx < postCheckoutResp.body.steps.length; stepIx++) {
            const actualStep = postCheckoutResp.body.steps[stepIx] as LightrailTransactionStep;
            const expectedValue = orderedValues[stepIx];
            chai.assert.equal(actualStep.rail, "lightrail");
            chai.assert.equal(actualStep.valueId, expectedValue.id, `mismatch on step ${stepIx}\n${JSON.stringify(postCheckoutResp.body.steps.map(step => orderedValues.find(value => value.id === (step as LightrailTransactionStep).valueId)), null, 2)}`);
        }
    }

    it("processes without redemptionRule before with", async () => {
        await testTransactionOrder({
            lineItems: [
                {
                    type: "product",
                    productId: "123",
                    unitPrice: 2
                }
            ],
            orderedValues: [
                {
                    balance: 1
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    }
                }
            ]
        });
    });

    it("processes Values that expire before those that don't", async () => {
        await testTransactionOrder({
            lineItems: [
                {
                    type: "product",
                    productId: "123",
                    unitPrice: 4
                }
            ],
            orderedValues: [
                {
                    balance: 1,
                    endDate: new Date("2098-01-01")
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2098-01-01")
                },
                {
                    balance: 1
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    }
                }
            ]
        });
    });

    it("processes Values that expire sooner before those that expire later", async () => {
        await testTransactionOrder({
            lineItems: [
                {
                    type: "product",
                    productId: "123",
                    unitPrice: 6
                }
            ],
            orderedValues: [
                {
                    balance: 1,
                    endDate: new Date("2098-01-01")
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2098-01-01")
                },
                {
                    balance: 1,
                    endDate: new Date("2198-01-01")
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2198-01-01")
                },
                {
                    balance: 1
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    }
                }
            ]
        });
    });

    it("processes Values that are discounts before those that aren't", async () => {
        await testTransactionOrder({
            lineItems: [
                {
                    type: "product",
                    productId: "123",
                    unitPrice: 12
                }
            ],
            orderedValues: [
                {
                    balance: 1,
                    endDate: new Date("2098-01-01"),
                    discount: true
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2098-01-01"),
                    discount: true
                },
                {
                    balance: 1,
                    endDate: new Date("2198-01-01"),
                    discount: true
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2198-01-01"),
                    discount: true
                },
                {
                    balance: 1,
                    discount: true
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    discount: true
                },
                {
                    balance: 1,
                    endDate: new Date("2098-01-01")
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2098-01-01")
                },
                {
                    balance: 1,
                    endDate: new Date("2198-01-01")
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    },
                    endDate: new Date("2198-01-01")
                },
                {
                    balance: 1
                },
                {
                    balance: 1,
                    redemptionRule: {
                        rule: "currentLineItem.productId == '123'",
                        explanation: ""
                    }
                }
            ]
        });
    });
});

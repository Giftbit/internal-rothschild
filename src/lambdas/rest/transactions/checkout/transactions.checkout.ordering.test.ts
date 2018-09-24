import * as cassava from "cassava";
import * as testUtils from "../../../../utils/testUtils";
import {createCurrency} from "../../currencies";
import {LineItem} from "../../../../model/LineItem";
import {Value} from "../../../../model/Value";
import {installRestRoutes} from "../../installRestRoutes";
import {generateId} from "../../../../utils/testUtils";
import * as chai from "chai";
import {Transaction} from "../../../../model/Transaction";
import {TransactionParty} from "../../../../model/TransactionRequest";

describe("/v2/transactions/checkout - ordering", () => {

    // When doing a Transaction with these Values they should definitely be applied in this order

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

    async function testTransactionOrder(lineItems: LineItem[], values: Partial<Value>[], additionalSources: TransactionParty[], orderedPlanSteps: ExpectedPlanStep[]): void {
        for (const value of values) {
            const createValueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueRes.statusCode, 201, `body=${JSON.stringify(createValueRes.body)}`);
        }

        const postCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
            id: generateId(),
            sources: [
                ...values.map(value => ({
                    rail: "lightrail",
                    valueId: value.id
                })),
                ...additionalSources
            ],
            lineItems: lineItems,
            currency: "CAD"
        });
        chai.assert.equal(postCheckoutResp.statusCode, 201, `body=${JSON.stringify(postCheckoutResp.body)}`);

        chai.assert.equal(postCheckoutResp.body.steps.length, orderedPlanSteps.length, "transaction has the expected number of steps");
        for (let stepIx = 0; stepIx < postCheckoutResp.body.steps.length; stepIx++) {
            chai.assert.equal(postCheckoutResp.body.steps[stepIx].rail, orderedPlanSteps[stepIx].rail, `transaction at step ${stepIx} is rail ${orderedPlanSteps[stepIx]}`);
            if (postCheckoutResp.body.steps[stepIx].rail === "lightrail") {
                chai.assert.equal(postCheckoutResp.body.steps[stepIx].valueId === orderedPlanSteps[stepIx].valueId);    // TODO
            }
        }
    }
});

type ExpectedPlanStep = {rail: "lightrail", valueId: string} | {rail: "stripe"};

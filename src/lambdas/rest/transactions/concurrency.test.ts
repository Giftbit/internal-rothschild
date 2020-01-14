import * as cassava from "cassava";
import * as chai from "chai";
import chaiExclude from "chai-exclude";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Value} from "../../../model/Value";
import {generateId} from "../../../utils/testUtils";
import * as testUtils from "../../../utils/testUtils/index";
import {CheckoutRequest, ReverseRequest} from "../../../model/TransactionRequest";
import {Transaction} from "../../../model/Transaction";

chai.use(chaiExclude);

/**
 * Note: Testing concurrency this way is not best practice and it should be emphasized that
 * these tests do not guarantee there are not bugs related to concurrency in our transaction
 * processing. These tests are here for now to provide minimal concurrency testing until a
 * better method for coverage can be supported.
 */
describe("transactions concurrency tests", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        const currency = await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
        chai.assert.equal(currency.code, "USD");
    });

    it("can't checkout against the same value twice using different checkout IDs", async () => {
        const promo: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100,
            discount: true
        };
        const createPromo1 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", promo);
        chai.assert.equal(createPromo1.statusCode, 201, JSON.stringify(createPromo1));

        const checkout1: CheckoutRequest = {
            id: generateId() + "-1",
            currency: "USD",
            sources: [
                {rail: "lightrail", valueId: promo.id},
            ],
            lineItems: [{unitPrice: 100}] // exactly what the promo is worth
        };
        const checkout2: CheckoutRequest = {...checkout1, id: generateId() + "-2"};

        const call1 = testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/checkout`, "POST", checkout1);
        const call2 = testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/transactions/checkout`, "POST", checkout2);

        const call1Result = await call1;
        const call2Result = await call2;

        chai.assert.equal(call1Result.statusCode, 201);
        chai.assert.equal(call2Result.statusCode, 409);
    });

    it("can't reverse the same transaction twice using different reverse IDs", async () => {
        const promo1: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100,
            discount: true
        };
        const createPromo1 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", promo1);
        chai.assert.equal(createPromo1.statusCode, 201, JSON.stringify(createPromo1));

        const promo2: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 100,
            discount: true
        };
        const createPromo2 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", promo2);
        chai.assert.equal(createPromo2.statusCode, 201, JSON.stringify(createPromo2));

        const checkout: CheckoutRequest = {
            id: generateId(),
            currency: "USD",
            sources: [
                {rail: "lightrail", valueId: promo1.id},
                {rail: "lightrail", valueId: promo2.id}
            ],
            lineItems: [{unitPrice: 5000}],
            allowRemainder: true
        };
        const createCheckout = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/checkout`, "POST", checkout);
        chai.assert.equal(createCheckout.statusCode, 201, `body=${JSON.stringify(createCheckout.body)}`);

        const reverse1: ReverseRequest = {
            id: generateId() + "-1"
        };
        const reverse2: ReverseRequest = {
            id: generateId() + "-2"
        };
        const call1 = testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse1);
        const call2 = testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/transactions/${checkout.id}/reverse`, "POST", reverse2);

        const call1Result = await call1;
        const call2Result = await call2;

        chai.assert.equal(call1Result.statusCode, 201);
        chai.assert.equal(call2Result.statusCode, 409);
        chai.assert.equal(call2Result.body["messageCode"], "TransactionReversed");
    });
});

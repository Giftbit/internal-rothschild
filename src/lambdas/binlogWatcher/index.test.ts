import * as cassava from "cassava";
import {Currency} from "../../model/Currency";
import * as testUtils from "../../utils/testUtils";
import {installRestRoutes} from "../rest/installRestRoutes";
import {createMySqlEventsInstance} from "./index";

describe.skip("binlogWatcher", () => {

    const router = new cassava.Router();

    const currency: Partial<Currency> = {
        code: "CAD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Pelts"
    };

    before(async function () {
        // await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        testUtils.setCodeCryptographySecrets();
        // await setStubsForStripeTests();
        // await createCurrency(testUtils.defaultTestUser.auth, currency);
    });

    it("test", async () => {
        const instance = await createMySqlEventsInstance();

        // const valueRes = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
        //     id: testUtils.generateId(),
        //     currency: "CAD",
        //     balance: 5000
        // });
        // chai.assert.equal(valueRes.statusCode, 201);

        // const checkoutRes = await testUtils.testAuthedRequest<Value>(router, "/v2/transactions/checkout", "POST", {
        //     id: testUtils.generateId(),
        //     currency: "CAD",
        //     lineItems: [
        //         {
        //             type: "product",
        //             unitPrice: 10000
        //         }
        //     ],
        //     sources: [
        //         {
        //             rail: "lightrail",
        //             valueId: valueRes.body.id
        //         },
        //         {
        //             rail: "stripe",
        //             source: "tok_visa"
        //         }
        //     ]
        // });
        // chai.assert.equal(checkoutRes.statusCode, 201, checkoutRes.bodyRaw);

        // const cancelRes = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${valueRes.body.id}`, "PATCH", {
        //     canceled: true
        // });
        // chai.assert.equal(cancelRes.statusCode, 200);

        await new Promise(resolve => setTimeout(resolve, 1000));

        await instance.stop();
    });
});

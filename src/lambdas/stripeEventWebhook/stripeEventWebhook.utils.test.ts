import * as testUtils from "../../utils/testUtils";
import {createUSDCheckout, generateId, testAuthedRequest} from "../../utils/testUtils";
import {Transaction} from "../../model/Transaction";
import * as chai from "chai";
import {getDbTransactionChain} from "../../utils/stripeEventWebhookRouteUtils";
import * as cassava from "cassava";
import {installRestRoutes} from "../rest/installRestRoutes";
import {createCurrency} from "../rest/currencies";

describe("gets transaction chain", () => {
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

    it("regular checkout + reverse", async () => {
        const checkoutSetup = await createUSDCheckout(router, null, false);

        const reverseResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutSetup.checkout.id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(reverseResp.statusCode, 201);

        const checkoutChain = await getDbTransactionChain(testUtils.defaultTestUser.auth, checkoutSetup.checkout.id);
        const reverseChain = await getDbTransactionChain(testUtils.defaultTestUser.auth, reverseResp.body.id);
        chai.assert.deepEqual(checkoutChain, reverseChain, `checkoutChain=${JSON.stringify(checkoutChain)}, reverseChain=${JSON.stringify(reverseChain)}`);
    });

    it("pending checkout + void", async () => {
        const checkoutSetup = await createUSDCheckout(router, {pending: true}, false);

        const voidResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutSetup.checkout.id}/void`, "POST", {id: generateId()});
        chai.assert.equal(voidResp.statusCode, 201);

        const checkout1Chain = await getDbTransactionChain(testUtils.defaultTestUser.auth, checkoutSetup.checkout.id);
        const voidChain = await getDbTransactionChain(testUtils.defaultTestUser.auth, voidResp.body.id);
        chai.assert.deepEqual(checkout1Chain, voidChain, `checkoutChain=${JSON.stringify(checkout1Chain)}, reverseChain=${JSON.stringify(voidChain)}`);
    });

    it("pending checkout + capture + reverse", async () => {
        const checkoutSetup = await createUSDCheckout(router, {pending: true}, false);

        const captureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutSetup.checkout.id}/capture`, "POST", {id: generateId()});
        chai.assert.equal(captureResp.statusCode, 201, `captureResp.body=${JSON.stringify(captureResp.body)}`);

        const reverseResp = await testAuthedRequest<Transaction>(router, `/v2/transactions/${captureResp.body.id}/reverse`, "POST", {id: generateId()});
        chai.assert.equal(reverseResp.statusCode, 201, `reverseResp.body=${JSON.stringify(reverseResp.body)}`);

        const checkoutChain = await getDbTransactionChain(testUtils.defaultTestUser.auth, checkoutSetup.checkout.id);
        const captureChain = await getDbTransactionChain(testUtils.defaultTestUser.auth, captureResp.body.id);
        const reverseChain = await getDbTransactionChain(testUtils.defaultTestUser.auth, reverseResp.body.id);
        chai.assert.deepEqual(checkoutChain, captureChain, `checkoutChain=${JSON.stringify(checkoutChain)}, captureChain=${JSON.stringify(captureChain)}`);
        chai.assert.deepEqual(checkoutChain, reverseChain, `checkoutChain=${JSON.stringify(checkoutChain)}, reverseChain=${JSON.stringify(reverseChain)}`);
    });
});

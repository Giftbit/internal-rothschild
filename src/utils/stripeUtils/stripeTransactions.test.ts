import * as chai from "chai";
import {
    setStubsForStripeTests,
    stripeLiveMerchantConfig,
    testStripeLive,
    unsetStubsForStripeTests
} from "../testUtils/stripeTestUtils";
import {createCharge} from "./stripeTransactions";
import {generateId} from "../testUtils";

describe("stripeTransactions", () => {

    before(async function () {
        setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("will retry on StripeCardErrors if the first response is an idempotent replay", async function () {
        if (testStripeLive()) {
            // This test relies upon a special token not implemented in the official server.
            this.skip();
        }

        const chargeParams = {
            currency: "usd",
            amount: 2000,
            source: "tok_chargeDeclinedInsufficientFunds|tok_visa"
        };

        let firstFail: any = null;
        try {
            await createCharge(chargeParams, true, stripeLiveMerchantConfig.stripeUserId, generateId() + "-0");
        } catch (err) {
            firstFail = err;
        }
        chai.assert.isDefined(firstFail);

        const charge = await createCharge(chargeParams, true, stripeLiveMerchantConfig.stripeUserId, generateId() + "-0");
    });
});

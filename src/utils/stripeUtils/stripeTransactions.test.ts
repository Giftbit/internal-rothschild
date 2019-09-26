import * as chai from "chai";
import {
    setStubsForStripeTests,
    stripeLiveMerchantConfig,
    testStripeLive,
    unsetStubsForStripeTests
} from "../testUtils/stripeTestUtils";
import {createCharge} from "./stripeTransactions";
import {generateId} from "../testUtils";
import {StripeRestError} from "./StripeRestError";

describe("stripeTransactions", () => {

    before(async function () {
        await setStubsForStripeTests();
    });

    after(() => {
        unsetStubsForStripeTests();
    });

    it("will retry on StripeCardErrors if the first response is an idempotent replay", async function () {
        if (testStripeLive()) {
            // This test relies upon a special token not implemented in the official server.
            this.skip();
        }

        // With this test token the Stripe mock server will return an error the
        // first time and succeed the second time.  This simulates a card being
        // topped up and the charge retried.
        const chargeParams = {
            currency: "usd",
            amount: 2000,
            source: "tok_chargeDeclinedInsufficientFunds|tok_visa"
        };

        const idempotencyKey = generateId() + "-0";
        let firstFail: any;
        try {
            // This charge will fail.
            await createCharge(chargeParams, true, stripeLiveMerchantConfig.stripeUserId, idempotencyKey);
        } catch (err) {
            firstFail = err;
        }
        chai.assert.isDefined(firstFail, "charge should fail the first time");
        chai.assert.instanceOf(firstFail, StripeRestError);

        // On this attempt Lightrail will try the charge, get the fail response
        // because it shares the idempotencyKey above, and then try again with the next
        // idempotencyKey.  Because we retry these idempotencyKeys in sequence we don't
        // risk double charging.
        const charge = await createCharge(chargeParams, true, stripeLiveMerchantConfig.stripeUserId, idempotencyKey);
        chai.assert.equal(charge.amount, 2000);
    });
});

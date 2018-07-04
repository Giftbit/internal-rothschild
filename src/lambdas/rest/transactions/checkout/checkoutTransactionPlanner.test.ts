import * as chai from "chai";
import {TransactionPlanStep} from "../TransactionPlan";
import {getAllPermutations, getStepPermutations} from "./checkoutTransactionPlanner";
import {Value} from "../../../../model/Value";

describe("optimizeCheckout", () => {

    const iBeforePostTax1: TransactionPlanStep = {
        rail: "internal",
        internalId: "1 before lightrail",
        balance: 1,
        pretax: false,
        beforeLightrail: true,
        amount: 1,
    };

    const iBeforePostTax2: TransactionPlanStep = {
        rail: "internal",
        internalId: "2 before lightrail",
        balance: 2,
        pretax: false,
        beforeLightrail: true,
        amount: 2,
    };

    const iAfterPostTax1: TransactionPlanStep = {
        rail: "internal",
        internalId: "1 after lightrail",
        balance: 1,
        pretax: false,
        beforeLightrail: false,
        amount: 1,
    };

    const iAfterPostTax2: TransactionPlanStep = {
        rail: "internal",
        internalId: "2 after lightrail",
        balance: 2,
        pretax: false,
        beforeLightrail: false,
        amount: 2,
    };

    const lrPostTax1: TransactionPlanStep = {
        rail: "lightrail",
        value: getValue(false),
        amount: 1
    };

    const lrPostTax2: TransactionPlanStep = {
        rail: "lightrail",
        value: getValue(false),
        amount: 2
    };

    const l3: TransactionPlanStep = {
        rail: "lightrail",
        value: getValue(false),
        amount: 3
    };

    const l4: TransactionPlanStep = {
        rail: "lightrail",
        value: getValue(false),
        amount: 4
    };

    const s1: TransactionPlanStep = {
        rail: "stripe",
        source: "tok_1",
        // stripeSecretKey: "secret",
        maxAmount: 1,
        amount: 1,
        idempotentStepId: "123"
    };
    const s2: TransactionPlanStep = {
        rail: "stripe",
        source: "tok_2",
        // stripeSecretKey: "secret",
        maxAmount: 2,
        amount: 2,
        idempotentStepId: "456"
    };

    describe("test getStepPermutations", function () {
        it("test 0 steps", async () => {
            const result = getStepPermutations([]);
            chai.assert.deepEqual(result, [[]]);
        });

        it("test 1 lightrail step", async () => {
            const result = getStepPermutations([lrPostTax1]);
            chai.assert.deepEqual(result, [[lrPostTax1]]);
        });

        it("test 2 lightrail steps", async () => {
            const result = getStepPermutations([lrPostTax1, lrPostTax2]);
            chai.assert.deepEqual(result, [[lrPostTax1, lrPostTax2], [lrPostTax2, lrPostTax1]]);
        });

        it("test 3 lightrail steps", async () => {
            const result = getStepPermutations([lrPostTax1, lrPostTax2, l3]);
            chai.assert.deepEqual(result, [[lrPostTax1, lrPostTax2, l3], [lrPostTax2, lrPostTax1, l3], [l3, lrPostTax1, lrPostTax2], [lrPostTax1, l3, lrPostTax2], [lrPostTax2, l3, lrPostTax1], [l3, lrPostTax2, lrPostTax1]]);
        });

        it("test 4 lightrail steps", async () => {
            const result = getStepPermutations([lrPostTax1, lrPostTax2, l3, l4]);
            chai.assert.equal(result.length, 24, `expected 4! = 24 entries.`);
        });

        it("test 1 stripe step", async () => {
            const result = getStepPermutations([s1]);
            chai.assert.deepEqual(result, [[s1]]);
        });

        it("test 2 stripe steps", async () => {
            const result = getStepPermutations([s1, s2]);
            chai.assert.deepEqual(result, [[s1, s2]]);

            const resultReversedOrder = getStepPermutations([s2, s1]);
            chai.assert.deepEqual(resultReversedOrder, [[s2, s1]]);
        });

        it("test 1 internal step", async () => {
            const result = getStepPermutations([iBeforePostTax1]);
            chai.assert.deepEqual(result, [[iBeforePostTax1]]);
        });

        it("test 2 internal steps", async () => {
            const result = getStepPermutations([iBeforePostTax1, iBeforePostTax2]);
            chai.assert.deepEqual(result, [[iBeforePostTax1, iBeforePostTax2]]);

            const resultReversedOrder = getStepPermutations([iBeforePostTax2, iBeforePostTax1]);
            chai.assert.deepEqual(resultReversedOrder, [[iBeforePostTax2, iBeforePostTax1]]);
        });

        it("test 2 internal steps but one before lightrail and one after. make sure before happens before even though no lightrail steps are supplied", async () => {
            const result = getStepPermutations([iAfterPostTax1, iBeforePostTax1]);
            chai.assert.deepEqual(result, [[iBeforePostTax1, iAfterPostTax1]]);
        });

        it("test one internal(before), two lightrail steps, one internal(after), one stripe ", async () => {
            const result = getStepPermutations([iBeforePostTax1, lrPostTax1, lrPostTax2, iAfterPostTax1, s1]);
            chai.assert.deepEqual(result, [[iBeforePostTax1, lrPostTax1, lrPostTax2, iAfterPostTax1, s1], [iBeforePostTax1, lrPostTax2, lrPostTax1, iAfterPostTax1, s1]]);

            const resultFromDifferentOrdering = getStepPermutations([iAfterPostTax1, s1, lrPostTax1, lrPostTax2, iBeforePostTax1]);
            chai.assert.deepEqual(resultFromDifferentOrdering, [[iBeforePostTax1, lrPostTax1, lrPostTax2, iAfterPostTax1, s1], [iBeforePostTax1, lrPostTax2, lrPostTax1, iAfterPostTax1, s1]]);
        });

        it("test complex steps: two internal(before), two lightrail steps, two internal(after), two stripe ", async () => {
            const result = getStepPermutations([iBeforePostTax1, iBeforePostTax2, lrPostTax1, lrPostTax2, iAfterPostTax1, iAfterPostTax2, s1, s2]);
            chai.assert.deepEqual(result, [[iBeforePostTax1, iBeforePostTax2, lrPostTax1, lrPostTax2, iAfterPostTax1, iAfterPostTax2, s1, s2], [iBeforePostTax1, iBeforePostTax2, lrPostTax2, lrPostTax1, iAfterPostTax1, iAfterPostTax2, s1, s2]]);

            const resultFromDifferentOrdering = getStepPermutations([iAfterPostTax1, s1, iAfterPostTax2, s2, lrPostTax1, lrPostTax2, iBeforePostTax1, iBeforePostTax2]);
            chai.assert.deepEqual(resultFromDifferentOrdering, [[iBeforePostTax1, iBeforePostTax2, lrPostTax1, lrPostTax2, iAfterPostTax1, s1, iAfterPostTax2, s2], [iBeforePostTax1, iBeforePostTax2, lrPostTax2, lrPostTax1, iAfterPostTax1, s1, iAfterPostTax2, s2]]);
        });
    });

    const lrPreTax1: TransactionPlanStep = {
        rail: "lightrail",
        value: getValue(true),
        amount: 1
    };

    const lrPreTax2: TransactionPlanStep = {
        rail: "lightrail",
        value: getValue(true),
        amount: 2
    };

    const iBeforePreTax1: TransactionPlanStep = {
        rail: "internal",
        internalId: "1 before lightrail",
        balance: 1,
        pretax: true,
        beforeLightrail: true,
        amount: 1,
    };

    const iBeforePreTax2: TransactionPlanStep = {
        rail: "internal",
        internalId: "2 before lightrail",
        balance: 2,
        pretax: true,
        beforeLightrail: true,
        amount: 2,
    };

    it("test getAllPermutations", async () => {
        const result = getAllPermutations([lrPostTax1, lrPostTax2, iBeforePostTax1, iBeforePostTax2, iAfterPostTax1, s1, iAfterPostTax2, s2, lrPreTax1, lrPreTax2, iBeforePreTax1, iBeforePreTax2]);
        chai.assert.deepEqual(result, [
            {
                preTaxSteps: [iBeforePreTax1, iBeforePreTax2, lrPreTax1, lrPreTax2],
                postTaxSteps: [iBeforePostTax1, iBeforePostTax2, lrPostTax1, lrPostTax2, iAfterPostTax1, s1, iAfterPostTax2, s2]
            },
            {
                preTaxSteps: [iBeforePreTax1, iBeforePreTax2, lrPreTax1, lrPreTax2],
                postTaxSteps: [iBeforePostTax1, iBeforePostTax2, lrPostTax2, lrPostTax1, iAfterPostTax1, s1, iAfterPostTax2, s2]
            },
            {
                preTaxSteps: [iBeforePreTax1, iBeforePreTax2, lrPreTax2, lrPreTax1],
                postTaxSteps: [iBeforePostTax1, iBeforePostTax2, lrPostTax1, lrPostTax2, iAfterPostTax1, s1, iAfterPostTax2, s2]
            },
            {
                preTaxSteps: [iBeforePreTax1, iBeforePreTax2, lrPreTax2, lrPreTax1],
                postTaxSteps: [iBeforePostTax1, iBeforePostTax2, lrPostTax2, lrPostTax1, iAfterPostTax1, s1, iAfterPostTax2, s2]
            }]);
    });

    function getValue(preTax: boolean): Value {
        return {
            id: null,
            currency: null,
            balance: null,
            uses: 5,
            programId: null,
            code: null,
            contactId: null,
            pretax: preTax,
            active: null,
            canceled: null,
            frozen: null,
            discount: null,
            discountSellerLiability: null,
            redemptionRule: null,
            valueRule: null,
            startDate: null,
            endDate: null,
            metadata: null,
            createdDate: null,
            updatedDate: null
        };
    }
});

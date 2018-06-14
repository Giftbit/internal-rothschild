import * as chai from "chai";
import {TransactionPlanStep} from "./TransactionPlan";
import {getStepPermutations} from "./buildCheckoutTransactionPlan";

describe("buildCheckoutTransactionPlan", () => {


    const iBefore1: TransactionPlanStep = {
        rail: "internal",
        internalId: "1 before lightrail",
        balance: 1,
        pretax: null, // doesn't matter for this test
        beforeLightrail: true,
        amount: 1,
    };

    const iBefore2: TransactionPlanStep = {
        rail: "internal",
        internalId: "2 before lightrail",
        balance: 2,
        pretax: null, // doesn't matter for this test
        beforeLightrail: true,
        amount: 2,
    };

    const iAfter1: TransactionPlanStep = {
        rail: "internal",
        internalId: "1 after lightrail",
        balance: 1,
        pretax: true, // doesn't matter for this test
        beforeLightrail: false,
        amount: 1,
    };

    const iAfter2: TransactionPlanStep = {
        rail: "internal",
        internalId: "2 after lightrail",
        balance: 2,
        pretax: true, // doesn't matter for this test
        beforeLightrail: false,
        amount: 2,
    };

    const l1: TransactionPlanStep = {
        rail: "lightrail",
        value: null,
        amount: 1
    };

    const l2: TransactionPlanStep = {
        rail: "lightrail",
        value: null,
        amount: 2
    };

    const l3: TransactionPlanStep = {
        rail: "lightrail",
        value: null,
        amount: 3
    };

    const l4: TransactionPlanStep = {
        rail: "lightrail",
        value: null,
        amount: 4
    };

    const s1: TransactionPlanStep = {
        rail: "stripe",
        token: "tok_1",
        stripeSecretKey: "secret",
        maxAmount: 1,
        amount: 1
    };
    const s2: TransactionPlanStep = {
        rail: "stripe",
        token: "tok_2",
        stripeSecretKey: "secret",
        maxAmount: 2,
        amount: 2
    };

    it("test 0 steps", async () => {
        const result = getStepPermutations([]);
        chai.assert.deepEqual(result, [[]])
    });

    it("test 1 lightrail step", async () => {
        const result = getStepPermutations([l1]);
        chai.assert.deepEqual(result, [[l1]])
    });

    it("test 2 lightrail steps", async () => {
        const result = getStepPermutations([l1, l2]);
        chai.assert.deepEqual(result, [[l1, l2], [l2, l1]])
    });

    it("test 3 lightrail steps", async () => {
        const result = getStepPermutations([l1, l2, l3]);
        // console.log(JSON.stringify(result));
        chai.assert.deepEqual(result, [[l1, l2, l3], [l2, l1, l3], [l3, l1, l2], [l1, l3, l2], [l2, l3, l1], [l3, l2, l1]])
    });

    it("test 4 lightrail steps", async () => {
        const result = getStepPermutations([l1, l2, l3, l4]);
        // console.log(JSON.stringify(result));
        chai.assert.equal(result.length, 24, `expected 4! = 24 entries.`);
    });

    it("test 1 stripe step", async () => {
        const result = getStepPermutations([s1]);
        chai.assert.deepEqual(result, [[s1]])
    });

    it("test 2 stripe steps", async () => {
        const result = getStepPermutations([s1, s2]);
        chai.assert.deepEqual(result, [[s1, s2]]);

        const resultReversedOrder = getStepPermutations([s2, s1]);
        chai.assert.deepEqual(resultReversedOrder, [[s2, s1]])
    });

    it("test 1 internal step", async () => {
        const result = getStepPermutations([iBefore1]);
        console.log(JSON.stringify(result));
        chai.assert.deepEqual(result, [[iBefore1]])
    });

    it("test 2 internal steps", async () => {
        const result = getStepPermutations([iBefore1, iBefore2]);
        chai.assert.deepEqual(result, [[iBefore1, iBefore2]]);

        const resultReversedOrder = getStepPermutations([iBefore2, iBefore1]);
        chai.assert.deepEqual(resultReversedOrder, [[iBefore2, iBefore1]])
    });

    it("test 2 internal steps but one before lightrail and one after. make sure before happens before even though no lightrail steps are supplied", async () => {
        const result = getStepPermutations([iAfter1, iBefore1]);
        chai.assert.deepEqual(result, [[iBefore1, iAfter1]]);
    });

    it("test one internal(before), two lightrail steps, one internal(after), one stripe ", async () => {
        const result = getStepPermutations([iBefore1, l1, l2, iAfter1, s1]);
        chai.assert.deepEqual(result, [[iBefore1, l1, l2, iAfter1, s1], [iBefore1, l2, l1, iAfter1, s1]]);

        const resultFromDifferentOrdering = getStepPermutations([iAfter1, s1, l1, l2, iBefore1]);
        chai.assert.deepEqual(resultFromDifferentOrdering, [[iBefore1, l1, l2, iAfter1, s1], [iBefore1, l2, l1, iAfter1, s1]]);
    });

    it("test complex steps: two internal(before), two lightrail steps, two internal(after), two stripe ", async () => {
        const result = getStepPermutations([iBefore1, iBefore2, l1, l2, iAfter1, iAfter2, s1, s2]);
        chai.assert.deepEqual(result, [[iBefore1, iBefore2, l1, l2, iAfter1, iAfter2, s1, s2], [iBefore1, iBefore2, l2, l1, iAfter1, iAfter2, s1, s2]]);

        const resultFromDifferentOrdering = getStepPermutations([iAfter1, s1, iAfter2, s2, l1, l2, iBefore1, iBefore2]);
        chai.assert.deepEqual(resultFromDifferentOrdering, [[iBefore1, iBefore2, l1, l2, iAfter1, s1, iAfter2, s2], [iBefore1, iBefore2, l2, l1, iAfter1, s1, iAfter2, s2]]);
    });
});
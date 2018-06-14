import * as chai from "chai";
import {TransactionPlanStep} from "./TransactionPlan";
import {getStepPermutations} from "./buildOrderTransactionPlan";

describe("buildOrderTransactionPlan", () => {
    it("test external rails are appended to lightrail permutations and order is preserved", async () => {
        const steps: TransactionPlanStep[] = [
            {
                rail: "lightrail",
                value: null,
                amount: 5
            },
            {
                rail: "lightrail",
                value: null,
                amount: 6
            },
            {
                rail: "stripe",
                token: "tok_sad32arw4f",
                stripeSecretKey: "secret",
                priority: 5,
                maxAmount: 50,
                amount: 50
            },
            {
                rail: "stripe",
                token: "tok_ers324aad",
                stripeSecretKey: "secret",
                priority: 5,
                maxAmount: null,
                amount: 50
            }
        ];
        const result = getStepPermutations(steps);
        console.log(JSON.stringify(result));
        chai.assert.deepEqual(result,
            [
                [
                    {
                        "rail": "lightrail",
                        "value": null,
                        "amount": 5
                    },
                    {
                        "rail": "lightrail",
                        "value": null,
                        "amount": 6
                    },
                    {
                        "rail": "stripe",
                        "token": "tok_sad32arw4f",
                        "stripeSecretKey": "secret",
                        "priority": 5,
                        "maxAmount": 50,
                        "amount": 50
                    },
                    {
                        "rail": "stripe",
                        "token": "tok_ers324aad",
                        "stripeSecretKey": "secret",
                        "priority": 5,
                        "maxAmount": null,
                        "amount": 50
                    }
                ],
                [
                    {
                        "rail": "lightrail",
                        "value": null,
                        "amount": 6
                    },
                    {
                        "rail": "lightrail",
                        "value": null,
                        "amount": 5
                    },
                    {
                        "rail": "stripe",
                        "token": "tok_sad32arw4f",
                        "stripeSecretKey": "secret",
                        "priority": 5,
                        "maxAmount": 50,
                        "amount": 50
                    },
                    {
                        "rail": "stripe",
                        "token": "tok_ers324aad",
                        "stripeSecretKey": "secret",
                        "priority": 5,
                        "maxAmount": null,
                        "amount": 50
                    }
                ]
            ])
    });

    it("test getStepPermutations when only non lightrail step included", async () => {
        const steps: TransactionPlanStep[] = [
            {
                rail: "stripe",
                token: "tok_sad32arw4f",
                stripeSecretKey: "secret",
                priority: 5,
                maxAmount: 50,
                amount: 50
            }
        ];
        const result = getStepPermutations(steps);
        chai.assert.deepEqual(result,
            [
                [

                    {
                        "rail": "stripe",
                        "token": "tok_sad32arw4f",
                        "stripeSecretKey": "secret",
                        "priority": 5,
                        "maxAmount": 50,
                        "amount": 50
                    }
                ]
            ])
    });
});
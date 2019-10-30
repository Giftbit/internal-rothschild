import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils/index";
import {generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../../utils/testUtils";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Value} from "../../../model/Value";
import {Transaction} from "../../../model/Transaction";
import {Contact} from "../../../model/Contact";
import {
    CheckoutRequest,
    CreditRequest,
    DebitRequest,
    LightrailTransactionParty,
    StripeTransactionParty,
    TransferRequest
} from "../../../model/TransactionRequest";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../utils/testUtils/stripeTestUtils";
import {after} from "mocha";

describe("/v2/values/ - secret stats capability", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "The Big Bucks",
            symbol: "$",
            decimalPlaces: 2
        });
        await setStubsForStripeTests();
    });

    after(async function () {
        unsetStubsForStripeTests();
    });

    describe("getting a single Value", () => {
        it("gets initialBalance > 0 when the Value was created with a balance > 0", async () => {
            const value: Partial<Value> = {
                id: "1",
                currency: "USD",
                balance: 1000
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const postDebitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: "debit-1",
                source: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 599,
                currency: "USD"
            });
            chai.assert.equal(postDebitResp.statusCode, 201, `body=${JSON.stringify(postDebitResp.body)}`);

            const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal(getValueResp.body.id, value.id);
            chai.assert.equal(getValueResp.body.balance, 401);
            chai.assert.deepEqual((getValueResp.body as any).stats, {
                initialBalance: 1000,
                initialUsesRemaining: null
            });
        });

        it("gets initialBalance = 0 when the Value was created with a balance = 0, even if credited later", async () => {
            const value: Partial<Value> = {
                id: "2",
                currency: "USD"
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const postCreditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
                id: "credit-1",
                destination: {
                    rail: "lightrail",
                    valueId: value.id
                },
                amount: 12345,
                currency: "USD"
            });
            chai.assert.equal(postCreditResp.statusCode, 201, `body=${JSON.stringify(postCreditResp.body)}`);

            const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal(getValueResp.body.id, value.id);
            chai.assert.equal(getValueResp.body.balance, 12345);
            chai.assert.deepEqual((getValueResp.body as any).stats, {
                initialBalance: 0,
                initialUsesRemaining: null
            });
        });

        it("gets initialBalance = null when the Value was created with a balance = null", async () => {
            const value: Partial<Value> = {
                id: "3",
                currency: "USD",
                balanceRule: {
                    "rule": "currentLineItem.lineTotal.subtotal * 0.1",
                    "explanation": "10% off"
                },
                redemptionRule: {
                    "rule": "currentLineItem.lineTotal.discount == 0",
                    "explanation": "cannot be combined"
                },
                usesRemaining: 1
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const getValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getValueResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
            chai.assert.equal(getValueResp.body.id, value.id);
            chai.assert.equal(getValueResp.body.balance, null);
            chai.assert.deepEqual((getValueResp.body as any).stats, {
                initialBalance: null,
                initialUsesRemaining: 1
            });
        });

        it("gets initialBalance on claimed generic Values", async () => {
            const value: Partial<Value> = {
                id: "4",
                currency: "USD",
                balance: 500,
                usesRemaining: 20,
                code: "FREE-MONEY!",
                isGenericCode: true
            };
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const contact: Partial<Contact> = {
                id: "claimer"
            };
            const createContactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContactResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const claimValueResp = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                code: value.code,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(createContactResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const getOriginalValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?stats=true`, "GET");
            chai.assert.equal(getOriginalValueResp.statusCode, 200, `body=${JSON.stringify(getOriginalValueResp.body)}`);
            chai.assert.equal(getOriginalValueResp.body.id, value.id);
            chai.assert.equal(getOriginalValueResp.body.balance, 500);
            chai.assert.deepEqual((getOriginalValueResp.body as any).stats, {
                initialBalance: 500,
                initialUsesRemaining: 20
            });

            const getClaimedValueResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${claimValueResp.body.id}?stats=true`, "GET");
            chai.assert.equal(getClaimedValueResp.statusCode, 200, `body=${JSON.stringify(getClaimedValueResp.body)}`);
            chai.assert.equal(getClaimedValueResp.body.id, claimValueResp.body.id);
            chai.assert.equal(getClaimedValueResp.body.balance, 500);
            chai.assert.deepEqual((getClaimedValueResp.body as any).stats, {
                initialBalance: 500,
                initialUsesRemaining: 1
            });
        });
    });

    describe("getting multiple Values", () => {
        it("gets the initialBalance stats laid out above", async () => {
            const getValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?id.in=1,2,3&stats=true`, "GET");
            chai.assert.equal(getValuesResp.statusCode, 200, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.lengthOf(getValuesResp.body, 3);

            const value1 = getValuesResp.body.find(v => v.id === "1");
            chai.assert.equal(value1.balance, 401);
            chai.assert.isObject((value1 as any).stats, `value1=${value1}`);
            chai.assert.deepEqual((value1 as any).stats, {
                initialBalance: 1000,
                initialUsesRemaining: null
            });

            const value2 = getValuesResp.body.find(v => v.id === "2");
            chai.assert.equal(value2.balance, 12345);
            chai.assert.isObject((value2 as any).stats, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.deepEqual((value2 as any).stats, {
                initialBalance: 0,
                initialUsesRemaining: null
            });

            const value3 = getValuesResp.body.find(v => v.id === "3");
            chai.assert.equal(value3.balance, null);
            chai.assert.isObject((value3 as any).stats, `body=${JSON.stringify(getValuesResp.body)}`);
            chai.assert.deepEqual((value3 as any).stats, {
                initialBalance: null,
                initialUsesRemaining: 1
            });
        });
    });

    it("/value/{id}/stats - generic code performance stats", async () => {
        const fullcode = "SUMMER2022";
        const value: Partial<Value> = {
            id: fullcode + "-id",
            currency: "USD",
            balanceRule: {
                rule: "50",
                explanation: "$0.50 off every item"
            },
            code: fullcode,
            isGenericCode: true,
            discount: true
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        // create contact A and attach
        const contactA: Partial<Contact> = {
            id: generateId(),
            firstName: "A"
        };
        const createContactA = await testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactA);
        chai.assert.equal(createContactA.statusCode, 201);
        const attachContactA = await testAuthedRequest<Value>(router, `/v2/contacts/${contactA.id}/values/attach`, "POST", {code: fullcode});
        chai.assert.equal(attachContactA.statusCode, 200);

        // create contact B and attach
        const contactB: Partial<Contact> = {
            id: generateId(),
            firstName: "B"
        };
        const createContactB = await testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactB);
        chai.assert.equal(createContactB.statusCode, 201);
        const attachContactB = await testAuthedRequest<Value>(router, `/v2/contacts/${contactB.id}/values/attach`, "POST", {code: fullcode});
        chai.assert.equal(attachContactB.statusCode, 200);

        // create another Value to be used as another payment source
        const giftCard: Partial<Value> = {
            id: "gc-id",
            currency: "USD",
            code: "GC123",
            balance: 500
        };
        const createGiftCard = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", giftCard);
        chai.assert.equal(createGiftCard.statusCode, 201);

        const creditCardSource: StripeTransactionParty = {
            rail: "stripe",
            source: "tok_visa"
        };
        const genericCodeSrc: LightrailTransactionParty = {
            rail: "lightrail",
            code: fullcode
        };
        const giftCardSrc: LightrailTransactionParty = {
            rail: "lightrail",
            code: giftCard.code
        };

        const transactionRequests: TransactionRequestData[] = [
            {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 101}], // discountLightrail: 50, remainder: 51
                    sources: [genericCodeSrc],
                    currency: "USD",
                    allowRemainder: true
                }
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 102}], // discountLightrail: 50, paidStripe: 52
                    sources: [genericCodeSrc, creditCardSource],
                    currency: "USD"
                }
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 103}],
                    sources: [genericCodeSrc, creditCardSource],
                    currency: "USD",
                    pending: true,
                },
                voided: true // no change
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 104}],
                    sources: [genericCodeSrc, creditCardSource],
                    currency: "USD",
                    pending: true,
                },
                captured: true // discountLightrail: 50, paidStripe: 54
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 105}],
                    sources: [genericCodeSrc, creditCardSource],
                    currency: "USD",
                },
                reversed: true // no change
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 106}],
                    sources: [genericCodeSrc, giftCardSrc], // discountLightrail: 50, paidLightrail: 56
                    currency: "USD",
                }
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 107}],
                    sources: [genericCodeSrc, creditCardSource],
                    currency: "USD",
                    pending: true,
                },
                captured: true,
                reversed: true // no change
            }
        ];

        await createTransactionData(transactionRequests);

        const getStats = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}/stats`, "GET");
        chai.assert.deepEqual(getStats.body, {
            "redeemed": {
                "balance": 200,
                "transactionCount": 4
            },
            "checkout": {
                "lightrailSpend": 256,
                "overspend": 157,
                "transactionCount": 4
            },
            "attachedContacts": {
                "count": 2
            }
        });
    }).timeout(20000);

    it("/value/{id}/stats - unique code performance stats", async () => {
        const value: Partial<Value> = {
            id: "uniqueCode-id",
            currency: "USD",
            balance: 500,
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        // create contact A and attach
        const contactA: Partial<Contact> = {
            id: generateId(),
            firstName: "A"
        };
        const createContactA = await testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactA);
        chai.assert.equal(createContactA.statusCode, 201);
        const attachContactA = await testAuthedRequest<Value>(router, `/v2/contacts/${contactA.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(attachContactA.statusCode, 200);

        const ccSrc: StripeTransactionParty = {
            rail: "stripe",
            source: "tok_visa"
        };
        const valueSrc: LightrailTransactionParty = {
            rail: "lightrail",
            valueId: value.id
        };

        const transactionRequests: TransactionRequestData[] = [
            {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 100}], // paidLightrail: 100, balance 400 after
                    sources: [valueSrc],
                    currency: "USD"
                }
            }, {
                type: "debit",
                request: {
                    id: generateId(),
                    source: valueSrc,
                    currency: "USD",
                    amount: 50 // balance 350 after
                },
            }, {
                type: "debit",
                request: {
                    id: generateId(),
                    source: valueSrc,
                    currency: "USD",
                    amount: 66,
                    pending: true
                },
                voided: true // balance 350 after
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 1000}],
                    sources: [valueSrc, ccSrc],
                    currency: "USD" // paidLightrail: 350. balance 0 after. 650 paidStripe
                }
            }, {
                type: "credit",
                request: {
                    id: generateId(),
                    destination: valueSrc,
                    currency: "USD",
                    amount: 600 // balance 600 after
                }
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 105}],
                    sources: [valueSrc, ccSrc],
                    currency: "USD",
                    pending: true,
                },
                captured: true // paidLightrail: 105, balance 495 after.
            }, {
                type: "debit",
                request: {
                    id: generateId(),
                    currency: "USD",
                    source: valueSrc,
                    amount: 50
                },
                reversed: true // no change
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 105}],
                    sources: [valueSrc, ccSrc],
                    currency: "USD",
                    pending: true,
                },
                captured: true,
                reversed: true // no change
            }, {
                type: "checkout",
                request: {
                    id: generateId(),
                    lineItems: [{unitPrice: 800}],
                    sources: [valueSrc],
                    currency: "USD",
                    allowRemainder: true // paidLightrail: 495, remainder: 198. balance after 0.
                }
            },
        ];

        await createTransactionData(transactionRequests);

        const stats = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}/stats`, "GET");
        chai.assert.deepEqual(stats.body, {
            "redeemed": {
                "balance": 100 + 50 + 350 + 105 + 495,
                "transactionCount": 5
            },
            "checkout": {
                "lightrailSpend": 100 + 350 + 105 + 495,
                "overspend": 650 + 305,
                "transactionCount": 4
            },
            "attachedContacts": {
                "count": 1
            }
        });
    }).timeout(10000);

    it("/value/{id}/stats - can get stats for code without any transactions or attached contacts", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balanceRule: {
                rule: "1",
                explanation: "$0.01 off everything!"
            }
        };

        const postValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(postValue.statusCode, 201);

        const getStats = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}/stats`, "GET");
        chai.assert.deepEqual(getStats.body, {
            "redeemed": {
                "balance": 0,
                "transactionCount": 0
            },
            "checkout": {
                "lightrailSpend": 0,
                "overspend": 0,
                "transactionCount": 0
            },
            "attachedContacts": {
                "count": 0
            }
        });
    });

    it("can't get stats for Value that doesn't exist - 404s", async () => {
        const getStats = await testUtils.testAuthedRequest<any>(router, `/v2/values/${generateId()}/stats`, "GET");
        chai.assert.equal(getStats.statusCode, 404);
    });


    async function createTransactionData(transactionRequests: TransactionRequestData[]): Promise<void> {
        for (const transactionRequest of transactionRequests) {
            let charge;
            const postTransaction = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transactionRequest.type}`, "POST", transactionRequest.request);
            chai.assert.equal(postTransaction.statusCode, 201);

            let capture: Transaction;
            if (transactionRequest.captured) {
                const postCapture = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transactionRequest.request.id}/capture`, "POST", {id: transactionRequest.request.id + "-capture"});
                chai.assert.equal(postCapture.statusCode, 201);
                capture = postCapture.body;
            } else if (transactionRequest.voided) {
                const postVoid = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transactionRequest.request.id}/void`, "POST", {id: transactionRequest.request.id + "-void"});
                chai.assert.equal(postVoid.statusCode, 201);
            }

            if (transactionRequest.reversed) {
                const transactionIdToReverse = capture ? capture.id : transactionRequest.request.id;
                const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${transactionIdToReverse}/reverse`, "POST", {id: transactionRequest.request.id + "-reverse"});
                chai.assert.equal(postReverse.statusCode, 201);
            }
        }
    }
});


interface TransactionRequestData {
    type: string;
    request: CheckoutRequest | DebitRequest | CreditRequest | TransferRequest;
    captured?: boolean;
    voided?: boolean;
    reversed?: boolean;
}


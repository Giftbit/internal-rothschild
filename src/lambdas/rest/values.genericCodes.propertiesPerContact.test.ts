import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateFullcode, generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {Value} from "../../model/Value";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Contact} from "../../model/Contact";
import {Transaction} from "../../model/Transaction";
import {CheckoutRequest, CreditRequest} from "../../model/TransactionRequest";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/values - generic code with per contact properties", () => {

    const router = new cassava.Router();

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, {
            code: "USD",
            name: "US Dollars",
            symbol: "$",
            decimalPlaces: 2
        });
    });

    it("balance will default to 0 as it does with non generic Values", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: null,
                    usesRemaining: 2
                }
            }
        };

        const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 201);
        chai.assert.deepInclude(create.body, genericValue);
        chai.assert.equal(create.body.balance, 0);
    });

    it("balance can be set to null if valuePropertiesPerContact.balance is set", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            balance: null,
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            }
        };

        const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 201);
        chai.assert.deepInclude(create.body, genericValue);
        chai.assert.isNull(create.body.balance);
    });

    it("one of balance, valuePropertiesPerContact.balance, or balanceRule must be set", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            balance: null,
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: null,
                    usesRemaining: 2
                }
            },
            balanceRule: null
        };

        const create = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 422);
        chai.assert.equal(create.body.message, "Value must have a balanceRule, a balance, or a genericCodeProperties.valuePropertiesPerContact.balance.")
    });

    describe("attach tests", () => {
        const contactId = generateId();

        before(async function () {
            const contact: Partial<Contact> = {
                id: contactId
            };

            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);
        });

        it("can't attach generic code with contact usage limits to same contact twice", async () => {
            const genericValue: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: 500,
                        usesRemaining: 2
                    }
                },
                balance: 5000,
                usesRemaining: 10
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
            chai.assert.deepEqualExcluding(attach.body,
                {
                    "id": null, // it's hashed
                    "currency": "USD",
                    "balance": 500,
                    "usesRemaining": 2,
                    "programId": null,
                    "issuanceId": null,
                    "contactId": contactId,
                    "code": null,
                    "attachedFromGenericValueId": genericValue.id,
                    "isGenericCode": false,
                    "pretax": false,
                    "active": true,
                    "canceled": false,
                    "frozen": false,
                    "discount": false,
                    "discountSellerLiability": null,
                    "redemptionRule": null,
                    "balanceRule": null,
                    "startDate": null,
                    "endDate": null,
                    "metadata": {
                        attachedFromGenericValue: {
                            code: genericValue.code
                        }
                    },
                    "createdDate": null,
                    "updatedDate": null,
                    "updatedContactIdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["id", "createdDate", "updatedDate", "updatedContactIdDate"]);

            const attachAgain = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attachAgain.statusCode, 409);
            chai.assert.equal(attachAgain.body["messageCode"], "ValueAlreadyAttached");
        });

        it("generic code with per contact usage limits will fail to attach if insufficient balance. can credit balance and then attach another contact", async () => {
            const genericValue: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: 500,
                        usesRemaining: 2
                    }
                },
                balance: 1200
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const contacts: Contact[] = [];
            for (let i = 0; i < 3; i++) {
                const contact: Partial<Contact> = {
                    id: generateId()
                };
                const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
                chai.assert.equal(createContact.statusCode, 201);
                contacts.push(createContact.body);

                if (i < 2) {
                    // succeeds for first 2 contacts
                    const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
                    chai.assert.equal(attach.statusCode, 200);
                } else {
                    // fails. insufficient funds
                    const attach = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
                    chai.assert.equal(attach.statusCode, 409);
                    chai.assert.equal(attach.body["messageCode"], "InsufficientBalance");
                }
            }

            const creditRequest: CreditRequest = {
                id: generateId(),
                currency: "USD",
                destination: {
                    rail: "lightrail",
                    valueId: genericValue.id
                },
                amount: 300
            };
            const credit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", creditRequest);
            chai.assert.equal(credit.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contacts[2].id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);

            const getTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${attach.body.id}/transactions?transactionType=attach`, "GET");
            chai.assert.deepEqualExcluding(getTx.body[0],
                {
                    "id": null,
                    "transactionType": "attach",
                    "currency": "USD",
                    "totals": null,
                    "lineItems": null,
                    "paymentSources": null,
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": genericValue.code,
                            "balanceBefore": 500,
                            "balanceAfter": 0,
                            "balanceChange": -500,
                            "usesRemainingBefore": null,
                            "usesRemainingAfter": null,
                            "usesRemainingChange": null
                        },
                        {
                            "rail": "lightrail",
                            "valueId": attach.body.id,
                            "contactId": contacts[2].id,
                            "code": null,
                            "balanceBefore": 0,
                            "balanceAfter": 500,
                            "balanceChange": 500,
                            "usesRemainingBefore": 0,
                            "usesRemainingAfter": 2,
                            "usesRemainingChange": 2
                        }
                    ],
                    "metadata": null,
                    "tax": null,
                    "pending": false,
                    "createdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["id", "createdDate"]);
        });

        it("generic code with per contact properties will fail to attach if insufficient usesRemaining. can credit usesRemaining and then attach another contact", async () => {
            const genericValue: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: 500,
                        usesRemaining: 2
                    }
                },
                usesRemaining: 5,
                balance: null
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const contacts: Contact[] = [];
            for (let i = 0; i < 3; i++) {
                const contact: Partial<Contact> = {
                    id: generateId()
                };
                const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
                chai.assert.equal(createContact.statusCode, 201);
                contacts.push(createContact.body);

                if (i < 2) {
                    // succeeds for first 2 contacts
                    const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
                    chai.assert.equal(attach.statusCode, 200);
                } else {
                    // fails. insufficient funds
                    const attach = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
                    chai.assert.equal(attach.statusCode, 409);
                    chai.assert.equal(attach.body["messageCode"], "InsufficientUsesRemaining");
                }
            }

            const creditRequest: CreditRequest = {
                id: generateId(),
                currency: "USD",
                destination: {
                    rail: "lightrail",
                    valueId: genericValue.id
                },
                uses: 2
            };
            const credit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", creditRequest);
            chai.assert.equal(credit.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contacts[2].id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
        });

        it("can create a generic value with per contact properties and no balance or usesRemaining liability controls", async () => {
            const genericValue: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: 500,
                        usesRemaining: 2
                    }
                },
                balance: null
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: generateId()});
            chai.assert.equal(createContact.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${createContact.body.id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);

            const getTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${attach.body.id}/transactions?transactionType=attach`, "GET");
            chai.assert.deepEqualExcluding(getTx.body[0],
                {
                    "id": null,
                    "transactionType": "attach",
                    "currency": "USD",
                    "totals": null,
                    "lineItems": null,
                    "paymentSources": null,
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": genericValue.code,
                            "balanceBefore": null,
                            "balanceAfter": null,
                            "balanceChange": null,
                            "usesRemainingBefore": null,
                            "usesRemainingAfter": null,
                            "usesRemainingChange": null
                        },
                        {
                            "rail": "lightrail",
                            "valueId": attach.body.id,
                            "contactId": createContact.body.id,
                            "code": null,
                            "balanceBefore": 0,
                            "balanceAfter": 500,
                            "balanceChange": 500,
                            "usesRemainingBefore": 0,
                            "usesRemainingAfter": 2,
                            "usesRemainingChange": 2
                        }
                    ],
                    "metadata": null,
                    "tax": null,
                    "pending": false,
                    "createdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["id", "createdDate"]);

        });

        it("test hashed id for attach", async () => {
            const genericValue: Partial<Value> = {
                id: "dontChangeValueId",
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: 500,
                        usesRemaining: 2
                    }
                },
                balance: null
            };

            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(createValue.statusCode, 201);
            chai.assert.deepNestedInclude(createValue.body, genericValue);

            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: "dontChangeContactId"});
            chai.assert.equal(createContact.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${createContact.body.id}/values/attach`, "POST", {valueId: genericValue.id});
            chai.assert.equal(attach.statusCode, 200);

            chai.assert.equal(createValue.body.id, "dontChangeValueId", "This should equal setValueId. Don't change this. This test checks for a consistent hash which prevents a Contact from attaching a generic code twice.");
            chai.assert.equal(createContact.body.id, "dontChangeContactId", "This should equal setValueId. Don't change this. This test checks for a consistent hash which prevents a Contact from attaching a generic code twice.");
            chai.assert.equal(attach.body.id, "3BzqT3K3VueDcNW7QGRXT+BJ0q4=", "The id should equal the expected hash of the contactId and valueId. It's important that this doesn't change since this prevents a Contact from attaching a generic code twice.");
        });

        it("can list values associated with generic value", async () => {
            const genericValue: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                genericCodeProperties: {
                    valuePropertiesPerContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                },
                balanceRule: {
                    rule: "200 + value.balanceChange",
                    explanation: "worth $2 off purchase"
                }
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const attachedValues: Value[] = [];
            for (let i = 0; i < 3; i++) {
                const contact: Partial<Contact> = {
                    id: generateId()
                };
                const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
                chai.assert.equal(createContact.statusCode, 201);

                const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
                chai.assert.equal(attach.statusCode, 200);
                attachedValues.push(attach.body);
            }

            const listAttachedValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?attachedFromGenericValueId=${genericValue.id}`, "GET");
            console.log(JSON.stringify(listAttachedValues, null, 4));
            chai.assert.sameDeepMembers(attachedValues, listAttachedValues.body);
        });
    });

    describe.only("generic code with balance rule, limited to 1 use per contact, and no liability controls (ie, balance = null, usesRemaining = null)", () => {
        const contact1Id = generateId();
        const contact2Id = generateId();
        const contact3Id = generateId();

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact1Id});
            chai.assert.equal(createContact1.statusCode, 201);
            const createContact2 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact2Id});
            chai.assert.equal(createContact2.statusCode, 201);
            const createContact3 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact3Id});
            chai.assert.equal(createContact3.statusCode, 201);
        });

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    usesRemaining: 1,
                    balance: null
                }
            },
            usesRemaining: null,
            balance: null,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off purchase"
            }
        };

        it("can create generic value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);
        });

        let valueAttachedToContact1: Value;
        it("can attach to contact1", async () => {
            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1Id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
            valueAttachedToContact1 = attach.body;
            console.log("valueAttachedToContact1 " + JSON.stringify(valueAttachedToContact1, null, 4));
        });

        it("can lookup attach transaction", async () => {
            chai.assert.isNotNull(valueAttachedToContact1, "Expected this to be set. earlier test must have failed.");
            const getTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${genericValue.id}/transactions?transactionType=attach`, "GET");
            chai.assert.deepInclude(getTx.body[0],
                {
                    "transactionType": "attach",
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": genericValue.code,
                            "balanceBefore": null,
                            "balanceAfter": null,
                            "balanceChange": null,
                            "usesRemainingBefore": null,
                            "usesRemainingAfter": null,
                            "usesRemainingChange": null
                        },
                        {
                            "rail": "lightrail",
                            "valueId": valueAttachedToContact1.id,
                            "contactId": valueAttachedToContact1.contactId,
                            "code": null,
                            "balanceBefore": null,
                            "balanceAfter": null,
                            "balanceChange": null,
                            "usesRemainingBefore": 0,
                            "usesRemainingAfter": 1,
                            "usesRemainingChange": 1
                        }
                    ]
                });
        });

        it("can attach to contact2", async () => {
            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact2Id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
        });

        it("can checkout against contact1", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", contactId: contact1Id}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkout.statusCode, 201);
            chai.assert.deepEqual(checkout.body.steps,
                [{
                    "rail": "lightrail",
                    "valueId": valueAttachedToContact1.id,
                    "contactId": contact1Id,
                    "code": null,
                    "balanceBefore": null,
                    "balanceAfter": null,
                    "balanceChange": -500,
                    "usesRemainingBefore": 1,
                    "usesRemainingAfter": 0,
                    "usesRemainingChange": -1
                }]
            );
        });

        it("can get generic code stats after contact1 checkout", async () => {
            const stats = await testUtils.testAuthedRequest(router, `/v2/values/${genericValue.id}/stats`, "GET");
            console.log(JSON.stringify(stats, null, 4));
        });

        it("contact 3 attaches")

    });

    // todo - test can't attach frozen generic value. or can you?
    // todo - test can't attach inactive generic value. or can you?
    // todo - test can't attach canceled generic value - this seems right.

// this might not be useful anymore.
    describe.skip("set of test to create a generic value, attach, view in context of contact, view in context of generic code, and checkout", () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "SIGNUP2019",
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            },
            balance: 5000,
            usesRemaining: 10
        };
        it("can create generic value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericValue.id}`, "GET");
            chai.assert.equal(get.statusCode, 200);
            chai.assert.deepEqual(create.body, get.body);
        });

        const contactId = generateId();
        let attachedValueId: string;
        it("can attach generic value", async () => {
            const contact: Partial<Contact> = {
                id: contactId
            };

            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
            chai.assert.deepEqualExcluding(attach.body,
                {
                    "id": null, // it's hashed
                    "currency": "USD",
                    "balance": 500,
                    "usesRemaining": 2,
                    "programId": null,
                    "issuanceId": null,
                    "contactId": contact.id,
                    "code": null,
                    "attachedFromGenericValueId": genericValue.id,
                    "isGenericCode": false,
                    "genericCodeProperties": null,
                    "pretax": false,
                    "active": true,
                    "canceled": false,
                    "frozen": false,
                    "discount": false,
                    "discountSellerLiability": null,
                    "redemptionRule": null,
                    "balanceRule": null,
                    "startDate": null,
                    "endDate": null,
                    "metadata": {
                        attachedFromGenericValue: {
                            code: "SIGNUP2019"
                        }
                    },
                    "createdDate": null,
                    "updatedDate": null,
                    "updatedContactIdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["id", "createdDate", "updatedDate", "updatedContactIdDate"]);
            attachedValueId = attach.body.id;


            const getTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/values/${attach.body.id}/transactions?transactionType=attach`, "GET");
            chai.assert.equal(getTx.statusCode, 200);
            chai.assert.deepEqualExcluding(getTx.body[0],
                {
                    "id": attach.body.id, // the transaction.id is the same as the new attached value.id.
                    "transactionType": "attach",
                    "currency": "USD",
                    "totals": null,
                    "lineItems": null,
                    "paymentSources": null,
                    "steps": [
                        {
                            "rail": "lightrail",
                            "valueId": genericValue.id,
                            "contactId": null,
                            "code": "SIGNUP2019",
                            "balanceBefore": 5000,
                            "balanceAfter": 4500,
                            "balanceChange": -500,
                            "usesRemainingBefore": 10,
                            "usesRemainingAfter": 8,
                            "usesRemainingChange": -2
                        },
                        {
                            "rail": "lightrail",
                            "valueId": attach.body.id,
                            "contactId": contactId,
                            "code": null,
                            "balanceBefore": 0,
                            "balanceAfter": 500,
                            "balanceChange": 500,
                            "usesRemainingBefore": 0,
                            "usesRemainingAfter": 2,
                            "usesRemainingChange": 2
                        }
                    ],
                    "metadata": null,
                    "tax": null,
                    "pending": false,
                    "createdDate": null,
                    "createdBy": "default-test-user-TEST"
                }, ["createdDate"]);

            const listContactValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId}/values`, "GET");
            chai.assert.equal(listContactValues.statusCode, 200);
            chai.assert.equal(listContactValues.body.length, 1);
            chai.assert.deepEqualExcluding(listContactValues.body[0], {
                "id": attach.body.id,
                "currency": "USD",
                "balance": 500,
                "usesRemaining": 2,
                "programId": null,
                "issuanceId": null,
                "contactId": contact.id,
                "code": null,
                "attachedFromGenericValueId": genericValue.id,
                "isGenericCode": false,
                "genericCodeProperties": null,
                "pretax": false,
                "active": true,
                "canceled": false,
                "frozen": false,
                "discount": false,
                "discountSellerLiability": null,
                "redemptionRule": null,
                "balanceRule": null,
                "startDate": null,
                "endDate": null,
                "metadata": {
                    attachedFromGenericValue: {
                        code: "SIGNUP2019"
                    }
                },
                "createdDate": null,
                "updatedDate": null,
                "updatedContactIdDate": null,
                "createdBy": "default-test-user-TEST"
            }, ["createdDate", "updatedDate", "updatedContactIdDate"]);
        });

        it("can checkout against generic code using contactId", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", contactId: contactId}
                ],
                lineItems: [
                    {unitPrice: 777}
                ],
                allowRemainder: true
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkout.statusCode, 201);
            chai.assert.deepEqualExcluding(checkout.body, {
                id: checkoutRequest.id,
                transactionType: "checkout",
                currency: "USD",
                createdDate: null,
                tax: {
                    roundingMode: "HALF_EVEN"
                },
                totals: {
                    subtotal: 777,
                    tax: 0,
                    discount: 0,
                    payable: 777,
                    remainder: 277,
                    discountLightrail: 0,
                    paidLightrail: 500,
                    paidStripe: 0,
                    paidInternal: 0
                },
                lineItems: [
                    {
                        unitPrice: 777,
                        quantity: 1,
                        lineTotal: {
                            subtotal: 777,
                            taxable: 777,
                            tax: 0,
                            discount: 0,
                            remainder: 277,
                            payable: 777
                        }
                    }
                ],
                steps: [
                    {
                        rail: "lightrail",
                        valueId: attachedValueId,
                        contactId: contactId,
                        code: null,
                        balanceBefore: 500,
                        balanceAfter: 0,
                        balanceChange: -500,
                        usesRemainingBefore: 2,
                        usesRemainingAfter: 1,
                        usesRemainingChange: -1
                    }
                ],
                paymentSources: [
                    {
                        rail: "lightrail",
                        contactId: contactId
                    }
                ],
                pending: false,
                metadata: null,
                createdBy: "default-test-user-TEST"
            }, ["createdDate"]);
        });
    });
})
;

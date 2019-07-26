import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../../utils/testUtils/index";
import {generateFullcode, generateId, setCodeCryptographySecrets} from "../../../utils/testUtils/index";
import {formatCodeForLastFourDisplay, Value} from "../../../model/Value";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {Contact} from "../../../model/Contact";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {CheckoutRequest, CreditRequest, ReverseRequest} from "../../../model/TransactionRequest";
import {generateUrlSafeHashFromValueIdContactId} from "../genericCodeWithPerContactOptions";
import {Program} from "../../../model/Program";
import {generateCode} from "../../../utils/codeGenerator";
import {generateLegacyHashForValueIdContactId} from "../contactValues";
import {getKnexWrite} from "../../../utils/dbUtils/connection";
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

    it("balance defaults to null if perContact.balance is set", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
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

    it("balance can be set to null if perContact.balance is set", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            balance: null,
            genericCodeOptions: {
                perContact: {
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

    it("can't set balanceRule and perContact.balance", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            },
            balanceRule: {
                rule: "500",
                explanation: "$5 off each item!"
            },
        };

        const create = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 422);
        chai.assert.equal(create.body.message, "Value can't have both a genericCodeOptions.perContact.balance and balanceRule.");
    });

    it("perContact.balance or balanceRule must be set if using perContact properties", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            balance: null,
            genericCodeOptions: {
                perContact: {
                    balance: null,
                    usesRemaining: 2
                }
            },
            balanceRule: null
        };

        const create = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 422);
        chai.assert.equal(create.body.message, "If using a generic code with genericCodeOption.perContact properties either genericCodeOptions.perContact.balance or balanceRule must be set.");
    });

    it("can't attach generic code with contact usage limits to same contact twice", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
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

        const contactId = generateId();
        const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {
            id: contactId
        });
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
                "contactId": contactId,
                "code": null,
                "attachedFromValueId": genericValue.id,
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

    it("insufficient balance will cause attach to fail. can credit balance and then attach another contact", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            },
            balance: 1200
        };
        const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
        chai.assert.equal(create.statusCode, 201);
        chai.assert.deepNestedInclude(create.body, genericValue);

        // try attaching to 3 contacts
        const contacts: Contact[] = [];
        const values: Value[] = [];
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
                values.push(attach.body);
            } else {
                // fails. insufficient funds
                const attach = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: genericValue.code});
                chai.assert.equal(attach.statusCode, 409);
                chai.assert.equal(attach.body["messageCode"], "InsufficientBalance");
            }
        }

        // credit generic code's balance
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
        values.push(attach.body);

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
                        "code": formatCodeForLastFourDisplay(genericValue.code),
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

        const getNewAttachedValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?attachedFromValueId=${genericValue.id}`, "GET");
        chai.assert.sameDeepMembers(getNewAttachedValues.body, values);
        const getAttachedContacts = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${genericValue.id}`, "GET");
        chai.assert.sameDeepMembers(getAttachedContacts.body, contacts);
    });

    it("generic code with per contact properties will fail to attach if insufficient usesRemaining. can credit usesRemaining and then attach another contact", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
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

        // try attaching to 3 contacts
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

        // credit uses remaining
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

        // try attaching again
        const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contacts[2].id}/values/attach`, "POST", {code: genericValue.code});
        chai.assert.equal(attach.statusCode, 200);
    });

    it("can create a generic value with per contact properties and no balance or usesRemaining liability controls", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
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
                        "code": formatCodeForLastFourDisplay(genericValue.code),
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
            genericCodeOptions: {
                perContact: {
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
        chai.assert.equal(attach.body.id, "3BzqT3K3VueDcNW7QGRXT-BJ0q4", "The id should equal the expected hash of the contactId and valueId. It's important that this doesn't change since this prevents a Contact from attaching a generic code twice.");
    });

    it("test hashed id for attach - test encoding: + replace with -, / replace with _ and the trailing = dropped", () => {
        // Important: The assertions these tests make should not be changed. If changed, Contacts will be able to attach a generic code they've already attached!
        chai.assert.equal(generateUrlSafeHashFromValueIdContactId("123", "456"), "vi_tcnr5gak5ZKguoofIlgj59yo");
        chai.assert.equal(generateUrlSafeHashFromValueIdContactId("se46ds", "6rdtfs4"), "QrSrg2mt3qeBfh47G1sqnGHOGe4");
        chai.assert.equal(generateUrlSafeHashFromValueIdContactId("/1ar,3a4/3aw4efsredfgs%a3as", "2353a4sadfsert5_2a=dfg"), "mXeuDmmVxP-V_-3K5s_QJIW3hoI");
    });

    it("can list values associated with generic value", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            genericCodeOptions: {
                perContact: {
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

        const listAttachedValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?attachedFromValueId=${genericValue.id}`, "GET");
        chai.assert.sameDeepMembers(attachedValues, listAttachedValues.body);
    });

    describe("happy path and stats", () => {
        const contact1Id = generateId();
        const contact2Id = generateId();
        const contact3Id = generateId();

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            discount: true,
            genericCodeOptions: {
                perContact: {
                    usesRemaining: 1,
                    balance: null
                }
            },
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off purchase"
            }
        };

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact1Id});
            chai.assert.equal(createContact1.statusCode, 201);
            const createContact2 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact2Id});
            chai.assert.equal(createContact2.statusCode, 201);
            const createContact3 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact3Id});
            chai.assert.equal(createContact3.statusCode, 201);

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);
        });

        let valueAttachedToContact1: Value;
        it("can attach to contact1", async () => {
            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1Id}/values/attach`, "POST", {code: genericValue.code});
            chai.assert.equal(attach.statusCode, 200);
            valueAttachedToContact1 = attach.body;
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
                            "code": formatCodeForLastFourDisplay(genericValue.code),
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
            chai.assert.equal(stats.statusCode, 200);
            chai.assert.deepEqual(stats.body, {
                "redeemed": {
                    "balance": 500,
                    "transactionCount": 1
                },
                "checkout": {
                    "lightrailSpend": 500,
                    "overspend": 277,
                    "transactionCount": 1
                },
                "attachedContacts": {
                    "count": 2
                }
            });
        });

        it("contact 3 auto-attaches via checkout", async () => {
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", code: genericValue.code},
                    {rail: "lightrail", contactId: contact3Id}
                ],
                lineItems: [
                    {unitPrice: 100},
                    {unitPrice: 125}
                ]
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkout.statusCode, 201);
            chai.assert.equal((checkout.body.steps[0] as LightrailTransactionStep).valueId, generateUrlSafeHashFromValueIdContactId(genericValue.id, contact3Id));
            chai.assert.equal((checkout.body.steps[0] as LightrailTransactionStep).balanceChange, -225);
        });

        it("can get stats", async () => {
            const stats = await testUtils.testAuthedRequest(router, `/v2/values/${genericValue.id}/stats`, "GET");
            chai.assert.equal(stats.statusCode, 200);
            chai.assert.deepEqual(stats.body, {
                "redeemed": {
                    "balance": 725,
                    "transactionCount": 2
                },
                "checkout": {
                    "lightrailSpend": 725,
                    "overspend": 277,
                    "transactionCount": 2
                },
                "attachedContacts": {
                    "count": 3
                }
            });
        });

        it("contact stats are correct for other types of generic code attaches", async () => {
            const legacyGenericValue: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                code: generateFullcode(),
                discount: true,
                balanceRule: {
                    rule: "500 + value.balanceChange",
                    explanation: "$5 off purchase"
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", legacyGenericValue);
            chai.assert.equal(create.statusCode, 201);

            // attach as shared
            const attachContact1 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1Id}/values/attach`, "POST", {code: legacyGenericValue.code});
            chai.assert.equal(attachContact1.statusCode, 200);

            // attachGenericAsNewValue
            const attachContact2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact2Id}/values/attach`, "POST", {
                code: legacyGenericValue.code,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attachContact2.statusCode, 200);

            const stats = await testUtils.testAuthedRequest(router, `/v2/values/${legacyGenericValue.id}/stats`, "GET");
            chai.assert.equal(stats.statusCode, 200);
            chai.assert.deepEqual(stats.body, {
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
                    "count": 2
                }
            });
        });
    });

    describe("stats on generic code with balance liability", () => {
        const contact1Id = generateId();

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            discount: true,
            genericCodeOptions: {
                perContact: {
                    usesRemaining: 1,
                    balance: 400
                }
            },
            balance: 1600
        };

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contact1Id});
            chai.assert.equal(createContact1.statusCode, 201);

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericValue);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.deepNestedInclude(create.body, genericValue);
        });

        it("stats don't include debits on the generic code itself", async () => {
            // debit balance
            const debit = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: "debit-1",
                source: {
                    rail: "lightrail",
                    valueId: genericValue.id
                },
                amount: 800, // effectively reduces attaches remaining by 2
                currency: "USD"
            });
            chai.assert.equal(debit.statusCode, 201);

            // do checkout (uses auto-attach)
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", code: genericValue.code},
                    {rail: "lightrail", contactId: contact1Id}
                ],
                lineItems: [
                    {unitPrice: 400}
                ]
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkout.statusCode, 201);

            const stats = await testUtils.testAuthedRequest(router, `/v2/values/${genericValue.id}/stats`, "GET");
            chai.assert.equal(stats.statusCode, 200);
            chai.assert.deepEqual(stats.body, {
                "redeemed": {
                    "balance": 400, // debit should not be included.
                    "transactionCount": 1
                },
                "checkout": {
                    "lightrailSpend": 400,
                    "overspend": 0,
                    "transactionCount": 1
                },
                "attachedContacts": {
                    "count": 1
                }
            });
        });
    });

    it("can reverse - the created value persists but the steps are reversed so it's effectively unusable", async () => {
        // create value
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            balance: 400,
            genericCodeOptions: {
                perContact: {
                    usesRemaining: 1,
                    balance: 100
                }
            },
            usesRemaining: 4,
            discount: true,
            isGenericCode: true
        };
        const postValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", genericValue);
        chai.assert.equal(postValue.statusCode, 201);

        // create contact
        const contact: Partial<Contact> = {
            id: generateId(),
            email: "kevin.bacon@example.com"
        };
        const postContact = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", contact);
        chai.assert.equal(postContact.statusCode, 201);

        // create attach
        const postAttach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: genericValue.id
        });
        chai.assert.equal(postAttach.statusCode, 200, `body=${JSON.stringify(postAttach.body)}`);
        chai.assert.equal(postAttach.body.contactId, contact.id); // returns the new value for the Contact
        chai.assert.equal(postAttach.body.usesRemaining, 1);

        // create reverse
        const attachTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${genericValue.id}&transactionType=attach`, "GET");
        const reverse: Partial<ReverseRequest> = {
            id: generateId()
        };
        const postReverse = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${encodeURIComponent(attachTx.body[0].id)}/reverse`, "POST", reverse); // attach on generic uses a hash so can have special characters
        chai.assert.equal(postReverse.statusCode, 201, `body=${JSON.stringify(postReverse.body)}`);
        chai.assert.deepEqualExcluding(postReverse.body, {
                "id": reverse.id,
                "transactionType": "reverse",
                "currency": "USD",
                "createdDate": null,
                "totals": null,
                "lineItems": null,
                "tax": null,
                "steps": [
                    {
                        "rail": "lightrail",
                        "valueId": genericValue.id,
                        "contactId": null,
                        "code": null,
                        "balanceBefore": 300,
                        "balanceAfter": 400,
                        "balanceChange": 100,
                        "usesRemainingBefore": 3,
                        "usesRemainingAfter": 4,
                        "usesRemainingChange": 1
                    },
                    {
                        "rail": "lightrail",
                        "valueId": postAttach.body.id,
                        "contactId": contact.id,
                        "code": null,
                        "balanceBefore": 100,
                        "balanceAfter": 0,
                        "balanceChange": -100,
                        "usesRemainingBefore": 1,
                        "usesRemainingAfter": 0,
                        "usesRemainingChange": -1
                    }
                ],
                "paymentSources": null,
                "pending": false,
                "metadata": null,
                "createdBy": "default-test-user-TEST"
            } as Transaction, ["createdDate"]
        );

        // check value is same as before
        const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericValue.id}`, "GET");
        chai.assert.deepEqualExcluding(getValue.body, postValue.body, ["updatedDate", "updatedContactIdDate"]);
    });

    describe("value state (inactive, frozen, cancelled) tests", () => {
        const genericValueTemplate: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: 10,
                    usesRemaining: 1
                }
            }
        };
        const contactId = generateId();

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(createContact1.statusCode, 201);
        });

        it("can't attach inactive value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...genericValueTemplate,
                id: generateId(),
                active: false
            } as Partial<Value>);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.isFalse(create.body.active);
            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
                valueId: create.body.id
            });
            chai.assert.equal(attach.statusCode, 409);
            chai.assert.equal(attach.body.messageCode, "ValueInactive");
        });

        it("can't attach frozen value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...genericValueTemplate,
                id: generateId(),
                frozen: true
            } as Partial<Value>);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.isTrue(create.body.frozen);
            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
                valueId: create.body.id
            });
            chai.assert.equal(attach.statusCode, 409);
            chai.assert.equal(attach.body.messageCode, "ValueFrozen");
        });

        it("can't attach frozen value", async () => {
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
                ...genericValueTemplate,
                id: generateId(),
            } as Partial<Value>);
            chai.assert.equal(create.statusCode, 201);

            const cancel = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${create.body.id}`, "PATCH", {
                canceled: true
            });
            chai.assert.equal(cancel.statusCode, 200);
            chai.assert.isTrue(cancel.body.canceled);
            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
                valueId: create.body.id
            });
            chai.assert.equal(attach.statusCode, 409);
            chai.assert.equal(attach.body.messageCode, "ValueCanceled");
        });
    });

    it("can't create generic code with genericCodeOptions and isGenericCode:false", async () => {
        const genericCode: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: false,
            genericCodeOptions: {
                perContact: {
                    balance: 10,
                    usesRemaining: 1
                }
            }
        };
        const create = await testUtils.testAuthedRequest(router, "/v2/values", "POST", genericCode);
        chai.assert.equal(create.statusCode, 422);
    });

    it("can't create generic code with genericCodeOptions.perContact = null and isGenericCode:false", async () => {
        const genericCode: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: false,
            genericCodeOptions: {
                perContact: null
            }
        };
        const create = await testUtils.testAuthedRequest(router, "/v2/values", "POST", genericCode);
        chai.assert.equal(create.statusCode, 422);
    });

    describe("program tests", () => {
        const contactId = generateId();

        before(async function () {
            const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
            chai.assert.equal(createContact.statusCode, 201);
        });

        it("program balance range tests", async () => {
            const program: Partial<Program> = {
                id: generateId(),
                name: generateId(10),
                currency: "USD",
                minInitialBalance: 5,
                maxInitialBalance: 10
            };
            const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(createProgram.statusCode, 201);

            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: null
                    }
                },
                programId: program.id
            };

            genericCode.genericCodeOptions.perContact.balance = null;
            let createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is null`);
            chai.assert.include(createGenericCode.body.message, "is less than minInitialBalance 5");

            genericCode.genericCodeOptions.perContact.balance = 1;
            createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is below allowed range`);
            chai.assert.include(createGenericCode.body.message, "is less than minInitialBalance 5");

            genericCode.genericCodeOptions.perContact.balance = 11;
            createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is above allowed range`);
            chai.assert.include(createGenericCode.body.message, "is greater than maxInitialBalance 10");

            genericCode.genericCodeOptions.perContact.balance = 7;
            createGenericCode = await testUtils.testAuthedRequest(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 201, `expected to succeed since it is within allowed range`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
                valueId: genericCode.id
            });
            chai.assert.equal(attach.statusCode, 200);
        });

        it("program fixedInitialBalance tests", async () => {
            const program: Partial<Program> = {
                id: generateId(),
                name: generateId(10),
                currency: "USD",
                fixedInitialBalances: [5]
            };
            const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(createProgram.statusCode, 201);

            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: null
                    }
                },
                programId: program.id
            };

            genericCode.genericCodeOptions.perContact.balance = null;
            let createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is null`);
            chai.assert.include(createGenericCode.body.message, "is outside fixedInitialBalances defined by Program");

            genericCode.genericCodeOptions.perContact.balance = 4;
            createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is below allowed range`);
            chai.assert.include(createGenericCode.body.message, "is outside fixedInitialBalances defined by Program");

            genericCode.genericCodeOptions.perContact.balance = 6;
            createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is above allowed range`);
            chai.assert.include(createGenericCode.body.message, "is outside fixedInitialBalances defined by Program");

            genericCode.genericCodeOptions.perContact.balance = 5;
            createGenericCode = await testUtils.testAuthedRequest(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 201, `expected to succeed since it is within allowed range`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
                valueId: genericCode.id
            });
            chai.assert.equal(attach.statusCode, 200);
        });

        it("program fixedInitialUsesRemaining tests", async () => {
            const program: Partial<Program> = {
                id: generateId(),
                name: generateId(10),
                currency: "USD",
                fixedInitialUsesRemaining: [5],
                balanceRule: {
                    rule: "value.balanceChange + 500",
                    explanation: "5$ off"
                }
            };
            const createProgram = await testUtils.testAuthedRequest<Program>(router, "/v2/programs", "POST", program);
            chai.assert.equal(createProgram.statusCode, 201);

            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: null
                    }
                },
                programId: program.id
            };

            genericCode.genericCodeOptions.perContact.usesRemaining = null;
            let createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is null`);
            chai.assert.include(createGenericCode.body.message, "outside fixedInitialUsesRemaining defined by Program");

            genericCode.genericCodeOptions.perContact.usesRemaining = 4;
            createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is below allowed range`);
            chai.assert.include(createGenericCode.body.message, "outside fixedInitialUsesRemaining defined by Program");

            genericCode.genericCodeOptions.perContact.usesRemaining = 6;
            createGenericCode = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 409, `expected to fail since it is above allowed range`);
            chai.assert.include(createGenericCode.body.message, "outside fixedInitialUsesRemaining defined by Program");

            genericCode.genericCodeOptions.perContact.usesRemaining = 5;
            createGenericCode = await testUtils.testAuthedRequest(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createGenericCode.statusCode, 201, `expected to succeed since it is within allowed range`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
                valueId: genericCode.id
            });
            chai.assert.equal(attach.statusCode, 200);
        });
    });

    describe("PATCH genericCodeOptions tests", () => {
        it("can update genericCodeOptions", async () => {
            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 100,
                        usesRemaining: 1
                    }
                },
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.equal(create.body.genericCodeOptions.perContact.balance, 100);

            const updateRequest: Partial<Value> = {
                genericCodeOptions: {
                    perContact: {
                        balance: 200,
                        usesRemaining: 2
                    }
                }
            };
            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "PATCH", updateRequest);
            chai.assert.equal(update.statusCode, 200);
            chai.assert.equal(update.body.genericCodeOptions.perContact.balance, 200);
            chai.assert.equal(update.body.genericCodeOptions.perContact.usesRemaining, 2);

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "GET");
            chai.assert.equal(get.statusCode, 200);
            chai.assert.equal(get.body.genericCodeOptions.perContact.balance, 200);
            chai.assert.equal(get.body.genericCodeOptions.perContact.usesRemaining, 2);
        });

        it("can update with undefined property which won't change other value", async () => {
            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 100,
                        usesRemaining: 1
                    }
                },
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(create.statusCode, 201);

            // usesRemaining not defined in genericCodeOptions.perContact
            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "PATCH", {
                genericCodeOptions: {
                    perContact: {
                        balance: 250
                    }
                }
            });
            chai.assert.equal(update.statusCode, 200);
            chai.assert.deepEqual(update.body.genericCodeOptions, {
                perContact: {
                    balance: 250,
                    usesRemaining: 1
                }
            });

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "GET");
            chai.assert.equal(get.statusCode, 200);
            chai.assert.deepEqual(get.body.genericCodeOptions, {
                perContact: {
                    balance: 250,
                    usesRemaining: 1
                }
            });
        });

        it("can't update to invalid property combination (balanceRule + perContact.balance)", async () => {
            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                },
                balanceRule: {
                    rule: "500 + value.balanceChange",
                    explanation: "five bucks"
                }
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.isNotNull(create.body.balanceRule);

            const updateRequest: Partial<Value> = {
                genericCodeOptions: {
                    perContact: {
                        balance: 200,
                        usesRemaining: 2
                    }
                }
            };
            const update = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${genericCode.id}`, "PATCH", updateRequest);
            chai.assert.equal(update.statusCode, 422);
            chai.assert.equal(update.body.message, "Value can't have both a genericCodeOptions.perContact.balance and balanceRule.");
        });

        it("can't update to invalid property combination (no balanceRule, balance or perContact.balance)", async () => {
            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 100,
                        usesRemaining: null
                    }
                }
            };
            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(create.statusCode, 201);

            const updateRequest: Partial<Value> = {
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: null
                    }
                }
            };
            const update = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${genericCode.id}`, "PATCH", updateRequest);
            chai.assert.equal(update.statusCode, 422);
            chai.assert.equal(update.body.message, "If using a generic code with genericCodeOption.perContact properties either genericCodeOptions.perContact.balance or balanceRule must be set.");
        });

        it("can drop perContact.usesRemaining from a generic code that has perContact.balance", async () => {
            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 100,
                        usesRemaining: 1
                    }
                },
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(create.statusCode, 201);

            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "PATCH", {
                genericCodeOptions: {
                    perContact: {
                        usesRemaining: null
                    }
                }
            });
            chai.assert.equal(update.statusCode, 200);
            chai.assert.deepEqual(update.body.genericCodeOptions, {
                perContact: {
                    balance: 100,
                    usesRemaining: null
                }
            });

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "GET");
            chai.assert.equal(get.statusCode, 200);
            chai.assert.deepEqual(get.body.genericCodeOptions, {
                perContact: {
                    balance: 100,
                    usesRemaining: null
                }
            });
        });

        it("can't remove genericCodeOptions from a Value", async () => {
            const genericCode: Partial<Value> = {
                id: generateId(),
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                },
                balanceRule: {
                    rule: "500 + value.balanceChange",
                    explanation: "five bucks"
                }
            };

            const create = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(create.statusCode, 201);
            chai.assert.isNotNull(create.body.balanceRule);

            const updateRequest: Partial<Value> = {
                genericCodeOptions: null
            };
            const update = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/values/${genericCode.id}`, "PATCH", updateRequest);
            chai.assert.equal(update.statusCode, 422);
            chai.assert.equal(update.body.message, "A value with genericCodeOptions cannot be updated to no longer have genericCodeOptions.");
        });
    });

    describe("migrate legacy generic code that used attachGenericAsNewValue param to perContact.usesRemaining=1", () => {
        const genericCode: Partial<Value> = {
            id: "genericCodeId54321",
            currency: "USD",
            code: generateCode({}),
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "five bucks"
            }
        };
        const contact: Partial<Contact> = {
            id: "contactId54321"
        };

        before(async function () {
            const createCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createCode.statusCode, 201);

            const knex = await getKnexWrite();
            await knex.transaction(async trx => {
                const updateRes: number = await trx("Values")
                    .where({
                        userId: testUtils.defaultTestUser.userId,
                        id: genericCode.id
                    })
                    .update({
                        createdDate: "2019-06-15 00:00:00.000"
                    });
                if (updateRes === 0) {
                    throw new cassava.RestError(404);
                }
                if (updateRes > 1) {
                    throw new Error(`Illegal UPDATE query.  Updated ${updateRes} values.`);
                }
            });

            const getGenericCode = await testUtils.testAuthedRequest<any>(router, `/v2/values/${encodeURI(genericCode.id)}`, "GET");
            chai.assert.equal(getGenericCode.statusCode, 200);
            chai.assert.equal(getGenericCode.body.createdDate, "2019-06-15T00:00:00.000Z");

            const createContact = await testUtils.testAuthedRequest<Value>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);

            // replicate how codes used to be attached. once this release goes live, all attached generic codes will use the generateUrlSafeHashFromValueIdContactId
            const attachedValue: Partial<Value> = {
                id: generateLegacyHashForValueIdContactId(genericCode.id, contact.id),
                currency: genericCode.currency,
                balanceRule: genericCode.balanceRule,
                contactId: contact.id,
                usesRemaining: 1
            };
            const attach = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", attachedValue);
            chai.assert.equal(attach.statusCode, 201);

            // manually set attachedFromValueId
            await knex.transaction(async trx => {
                const updateRes: number = await trx("Values")
                    .where({
                        userId: testUtils.defaultTestUser.userId,
                        id: attachedValue.id
                    })
                    .update({
                        attachedFromValueId: genericCode.id,
                        createdDate: "2019-06-15 00:00:00.000"
                    });
                if (updateRes === 0) {
                    throw new cassava.RestError(404);
                }
                if (updateRes > 1) {
                    throw new Error(`Illegal UPDATE query.  Updated ${updateRes} values.`);
                }
            });

            const get = await testUtils.testAuthedRequest<any>(router, `/v2/values/${encodeURI(attachedValue.id)}`, "GET");
            chai.assert.equal(get.statusCode, 200);
            chai.assert.equal(get.body.createdDate, "2019-06-15T00:00:00.000Z");
            chai.assert.equal(get.body.attachedFromValueId, genericCode.id);
        });

        it("attach with attachGenericAsNewValue: true fails (already attached)", async () => {
            const listValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");

            // can attach the generic code using the legacy attachGenericAsNewValue=true param
            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                code: genericCode.code,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attach.statusCode, 409);
            chai.assert.equal(attach.body.messageCode, "ValueAlreadyAttached");
        });

        it("can migrate code to have genericCodeOptions and attach still 409s", async () => {
            const updateRequest: Partial<Value> = {
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                }
            };

            const update = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "PATCH", updateRequest);
            chai.assert.equal(update.statusCode, 200);
            chai.assert.isNull(update.body.genericCodeOptions.perContact.balance);
            chai.assert.equal(update.body.genericCodeOptions.perContact.usesRemaining, 1);

            const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "GET");
            chai.assert.equal(get.body.genericCodeOptions.perContact.usesRemaining, 1);
            chai.assert.isNull(get.body.genericCodeOptions.perContact.balance);

            // can't attach migrated generic code to same contact
            const attachAgain = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                code: genericCode.code,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attachAgain.statusCode, 409);
        });
    });

    describe("can't add generic code options to a shared generic code that's been attached to a contact", () => {
        const genericCode: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            code: generateCode({}),
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "five bucks"
            }
        };
        const contact: Partial<Contact> = {
            id: generateId()
        };

        before(async function () {
            const createCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
            chai.assert.equal(createCode.statusCode, 201);

            const createContact = await testUtils.testAuthedRequest<Value>(router, "/v2/contacts", "POST", contact);
            chai.assert.equal(createContact.statusCode, 201);

            const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
                code: genericCode.code
            });
            chai.assert.equal(attach.statusCode, 200);
        });

        it("can't add generic code options", async () => {
            const updateRequest: Partial<Value> = {
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                }
            };

            const update = await testUtils.testAuthedRequest<any>(router, `/v2/values/${genericCode.id}`, "PATCH", updateRequest);
            chai.assert.equal(update.statusCode, 422);
            chai.assert.equal(update.body.message, "A shared generic value without genericCodeOptions cannot be updated to have genericCodeOptions.");
        });
    });

    it("changeCode", async () => {
        const genericCode: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            code: generateCode({}),
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: 100,
                    usesRemaining: null
                }
            }
        };
        const createCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
        chai.assert.equal(createCode.statusCode, 201);

        const changeCode = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}/changeCode`, "POST", {
            code: generateCode({}),
            isGenericCode: false
        });
        chai.assert.equal(changeCode.statusCode, 200);

        const get = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${genericCode.id}`, "GET");
        chai.assert.equal(get.statusCode, 200);
        chai.assert.isFalse(get.body.isGenericCode);
        chai.assert.equal(get.body.genericCodeOptions.perContact.balance, 100);

        const checkoutRequest: CheckoutRequest = {
            id: generateId(),
            currency: "USD",
            lineItems: [
                {unitPrice: 1000}
            ],
            allowRemainder: true,
            sources: [{rail: "lightrail", valueId: genericCode.id}]
        };
        const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
    });
});
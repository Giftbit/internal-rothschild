import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {installRestRoutes} from "./installRestRoutes";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {Contact} from "../../model/Contact";
import {CreditRequest} from "../../model/TransactionRequest";
import {Transaction} from "../../model/Transaction";
import chaiExclude = require("chai-exclude");

chai.use(chaiExclude);

describe("/v2/values/", () => {

    const router = new cassava.Router();
    const contactId = generateId();

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

        const contact: Partial<Contact> = {
            id: contactId
        };

        const createContact = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
        chai.assert.equal(createContact.statusCode, 201);
    });

    it("can't attach generic code with contact usage limits twice", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "ABC12345",
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

    it("generic code with per contact usage limits will fail to attach if insufficient balance. can credit and then attach another contact", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "QWERTY123",
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
                        "code": "QWERTY123",
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


    it("generic code with per contact usage limits will fail to attach if insufficient balance. can credit and then attach another contact", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "ABBAXYZ",
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            },
            usesRemaining: 5
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

    it("can create a generic value with balance == null, usesRemaining == null, and valuePropertiesPerContact.balance != null", async () => {
        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: "SUMMERTIME2020",
            genericCodeProperties: {
                valuePropertiesPerContact: {
                    balance: 500,
                    usesRemaining: 2
                }
            }
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
                        "code": "SUMMERTIME2020",
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
});

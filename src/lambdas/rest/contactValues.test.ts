import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Contact} from "../../model/Contact";
import {installRestRoutes} from "./installRestRoutes";
import * as testUtils from "../../utils/testUtils";
import {defaultTestUser, generateFullcode, generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {createContact} from "./contacts";
import {Currency} from "../../model/Currency";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {getContactValue} from "./contactValues";
import {
    ResolveTransactionPartiesOptions,
    resolveTransactionPlanSteps
} from "./transactions/resolveTransactionPlanSteps";
import {LightrailTransactionPlanStep} from "./transactions/TransactionPlan";

describe.only("/v2/contacts/values", () => {

    const router = new cassava.Router();

    const currency: Currency = {
        code: "AUD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Dollarydoo"
    };

    const contact: Contact = {
        id: "c-1",
        firstName: null,
        lastName: null,
        email: null,
        metadata: null,
        createdDate: new Date(),
        updatedDate: new Date(),
        createdBy: defaultTestUser.auth.teamMemberId
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, currency);
        await createContact(testUtils.defaultTestUser.auth, contact);
    });

    it("can attach a code-less Value by valueId", async () => {
        const value: Partial<Value> = {
            id: "add-code-less-by-id",
            currency: currency.code
        };
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.isNotNull(resp2.body.updatedContactIdDate);
        chai.assert.equal(resp2.body.updatedContactIdDate, resp2.body.updatedDate);
    });

    describe("can attach a generic-code Value by code", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: generateFullcode(),
            isGenericCode: true,
            usesRemaining: 20
        };

        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        // Attach. Should return original Value.
        const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value.code});
        chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);
        chai.assert.isNull(attach.body.contactId);
        chai.assert.equal(attach.body.usesRemaining, value.usesRemaining, "uses remaining is not reduced during attach");

        // Value is now attached to Contact
        const listValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
        chai.assert.equal(listValues.statusCode, 200);
        chai.assert.deepEqual(listValues.body.find(v => v.id === createValueResp.body.id), createValueResp.body);

        // Attempting to attach again results in a 409
        const attachAgain = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value.code});
        chai.assert.equal(attachAgain.statusCode, 409, `body=${JSON.stringify(attach.body)}`);
        chai.assert.equal(attachAgain.body.messageCode, "ValueAlreadyAttached");
    });

    it("can attach a unique-code Value by valueId", async () => {
        const value: Partial<Value> = {
            id: "add-unique-by-id",
            currency: currency.code,
            code: generateFullcode(),
        };

        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, value.id);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.code, `…${value.code.slice(-4)}`);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
    });

    it("can attach a unique-code Value by code", async () => {
        const value: Partial<Value> = {
            id: "add-unique-by-code",
            currency: currency.code,
            code: generateFullcode(),
        };

        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value.code});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, value.id);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.code, `…${value.code.slice(-4)}`);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
    });

    it("can attach a unique-generated-code Value by code", async () => {
        const value: Partial<Value> = {
            id: "add-generated-by-code",
            currency: currency.code
        };

        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            ...value,
            generateCode: {
                length: 12
            }
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        const getCodeResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}?showCode=true`, "GET");
        chai.assert.equal(getCodeResp.statusCode, 200, `body=${JSON.stringify(getCodeResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: getCodeResp.body.code});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, value.id);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.code, `…${getCodeResp.body.code.slice(-4)}`);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
    });

    const contact2: Contact = {
        id: "c-2",
        firstName: null,
        lastName: null,
        email: null,
        metadata: null,
        createdDate: new Date(),
        updatedDate: new Date(),
        createdBy: defaultTestUser.auth.teamMemberId
    };

    describe('attach behaviour for unique code based on JWT', function () {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            code: generateFullcode(),
        };

        before(async () => {
            const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value.code});
            chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        });

        it("cannot attach an already attached value using a token scoped to a Contact", async () => {
            await createContact(testUtils.defaultTestUser.auth, contact2);
            const contact2Badge = new giftbitRoutes.jwtauth.AuthorizationBadge(testUtils.defaultTestUser.auth.getJwtPayload());
            contact2Badge.contactId = contact2.id;
            contact2Badge.scopes.push("lightrailV2:values:attach:self");

            const resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/contacts/${contact2.id}/values/attach`, "POST", {
                headers: {
                    Authorization: `Bearer ${contact2Badge.sign("secret")}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({code: value.code})
            }));
            chai.assert.equal(resp.statusCode, 409, `body=${resp.body}`);
            chai.assert.equal(JSON.parse(resp.body).messageCode, "ValueNotFound", `body=${resp.body}`);
        });

        it("can attach an already attached value using a plain JWT", async () => {
            const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact2.id}/values/attach`, "POST", {code: value.code});
            chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.id, value.id);
            chai.assert.equal(resp.body.contactId, contact2.id);
            chai.assert.equal(resp.body.code, `…${value.code.slice(-4)}`);
            chai.assert.isNotNull(resp.body.updatedContactIdDate);
            chai.assert.equal(resp.body.updatedContactIdDate, resp.body.updatedDate);
        });
    });

    describe('attach Value in state cases: frozen, cancelled, expired, inactive, usesRemaining=0', function () {
        for (const isGenericCode of [true, false]) {
            it(`cannot attach a frozen isGeneric=${isGenericCode} Value`, async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    isGenericCode: isGenericCode
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

                const update: Partial<Value> = {
                    frozen: true
                };
                const patchUpdate = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", update);
                chai.assert.equal(patchUpdate.statusCode, 200, `body=${JSON.stringify(patchUpdate.body)}`);

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 409, `body=${JSON.stringify(attach.body)}`);
                chai.assert.equal(attach.body.messageCode, "ValueFrozen");
            });

            it(`cannot attach a canceled isGeneric=${isGenericCode} Value`, async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    isGenericCode: isGenericCode
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

                const update: Partial<Value> = {
                    canceled: true
                };
                const patchUpdate = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "PATCH", update);
                chai.assert.equal(patchUpdate.statusCode, 200, `body=${JSON.stringify(patchUpdate.body)}`);

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 409, `body=${JSON.stringify(attach.body)}`);
                chai.assert.equal(attach.body.messageCode, "ValueCanceled");
            });

            it(`can attach if currentDate < startDate isGeneric=${isGenericCode} Value`, async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    isGenericCode: isGenericCode,
                    startDate: new Date("2077-01-01")
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);
            });

            it(`cannot attach if currentDate > endDate isGeneric=${isGenericCode} Value`, async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    isGenericCode: isGenericCode,
                    endDate: new Date("2011-01-01")
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

                // probably need to create the Value and then manually update DB for endDate to be in the past.

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 409, `body=${JSON.stringify(attach.body)}`);
                chai.assert.equal(attach.body.messageCode, "ValueExpired");
            });

            it(`can attach if active=false isGeneric=${isGenericCode} Value`, async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    isGenericCode: isGenericCode,
                    active: false
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);
            });

            it(`cannot attach if usesRemaining=0 isGeneric=${isGenericCode} Value`, async () => {
                const value: Partial<Value> = {
                    id: generateId(),
                    currency: currency.code,
                    isGenericCode: isGenericCode,
                    usesRemaining: 0
                };
                const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
                chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 409, `body=${JSON.stringify(attach.body)}`);
                chai.assert.equal(attach.body.messageCode, "InsufficientUsesRemaining");
            });
        }
    });

    describe("can list values attached to a contact and contacts who've attach a value", () => {
        const contactA: Partial<Contact> = {
            id: generateId(5) + "A",
            firstName: "A",
        };
        const contactB: Partial<Contact> = {
            id: generateId(5) + "B",
            firstName: "B",
        };
        const contacts: Contact[] = [];
        const valuesAttachedToContactA: Value[] = [];
        const valuesAttachedToContactB: Value[] = [];

        const uniqueValueWithContact: Partial<Value> = {
            id: generateId(5) + "unique-belongsToA",
            currency: currency.code,
            contactId: contactA.id
        };

        const uniqueValue: Partial<Value> = {
            id: generateId(5) + "-unique-attachToA",
            currency: currency.code,
        };

        const genVal1: Partial<Value> = {
            id: generateId(5) + "-GEN1",
            currency: currency.code,
            isGenericCode: true
        };

        const genVal2: Partial<Value> = {
            id: generateId(5) + "-GEN2",
            currency: currency.code,
            isGenericCode: true
        };

        const genVal3: Partial<Value> = {
            id: generateId(5) + "-GEN3",
            currency: currency.code,
            isGenericCode: true
        };

        before(async () => {
            // create contacts
            const createContactA = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", contactA);
            chai.assert.equal(createContactA.statusCode, 201);
            contacts.push(createContactA.body);
            const createContactB = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", contactB);
            chai.assert.equal(createContactB.statusCode, 201);
            contacts.push(createContactB.body);

            // create genericVal1
            const createGenericVal1 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", genVal1);
            chai.assert.equal(createGenericVal1.statusCode, 201);

            // create a genericVal2
            const createGenVal2 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", genVal2);
            chai.assert.equal(createGenVal2.statusCode, 201);

            // create a genericVal3
            const createGenVal3 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", genVal3);
            chai.assert.equal(createGenVal3.statusCode, 201);

            /** ContactA Attached Values **/
                // unique value created with contactId set to ContactA
            const createUniqueValueWithContact = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", uniqueValueWithContact);
            chai.assert.equal(createUniqueValueWithContact.statusCode, 201);
            valuesAttachedToContactA.push(createUniqueValueWithContact.body);

            // attach unique value to ContactA
            const createUniqueValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", uniqueValue);
            chai.assert.equal(createUniqueValue.statusCode, 201);

            const attachUniqueValue = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactA.id}/values/attach`, "POST", {valueId: uniqueValue.id});
            chai.assert.equal(attachUniqueValue.statusCode, 200);
            valuesAttachedToContactA.push(attachUniqueValue.body);

            // attach genericVal1 to ContactA as new Value
            const attachNew_genVal1_contactA = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactA.id}/values/attach`, "POST", {
                valueId: genVal1.id,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attachNew_genVal1_contactA.statusCode, 200);
            valuesAttachedToContactA.push(attachNew_genVal1_contactA.body /* new value from attach */);

            // attach genVal2 to ContactA
            const attach_genVal2_contactA = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactA.id}/values/attach`, "POST", {valueId: genVal2.id});
            chai.assert.equal(attach_genVal2_contactA.statusCode, 200);
            valuesAttachedToContactA.push(createGenVal2.body /* original value attached */);

            // attach genVal3 to ContactA
            const attach_genVal3_contactA = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactA.id}/values/attach`, "POST", {valueId: genVal3.id});
            chai.assert.equal(attach_genVal3_contactA.statusCode, 200);
            valuesAttachedToContactA.push(createGenVal3.body /* original value attached */);

            /** ContactB Attached Values **/
            const attachNew_genVal1_contactB = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactB.id}/values/attach`, "POST", {
                valueId: genVal1.id,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attachNew_genVal1_contactB.statusCode, 200);
            valuesAttachedToContactB.push(attachNew_genVal1_contactB.body /* new value from attach */);

            const attach_genVal2_contactB = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactB.id}/values/attach`, "POST", {valueId: genVal2.id});
            chai.assert.equal(attach_genVal2_contactB.statusCode, 200);
            valuesAttachedToContactB.push(createGenVal2.body /* original value attached */);
        });

        it("can list contacts associated with unique code", async () => {
            const contactListValues = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${uniqueValueWithContact.id}`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, contacts.filter(contact => contact.id === uniqueValueWithContact.contactId));
        });

        it('can list values attached to contactA', async () => {
            const contactListValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactA.id}/values`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, valuesAttachedToContactA);

            const listValuesByContact = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contactA.id}`, "GET");
            chai.assert.sameDeepMembers(listValuesByContact.body, valuesAttachedToContactA);
        });

        it('can list values attached to contactB', async () => {
            const contactListValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactB.id}/values`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, valuesAttachedToContactB);

            const listValuesByContact = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contactB.id}`, "GET");
            chai.assert.sameDeepMembers(listValuesByContact.body, valuesAttachedToContactB);
        });

        it('can list contacts who have attached genVal1 but returns none since genericValue1 was attached as new Values', async () => {
            const contactListValues = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${genVal1.id}`, "GET");
            chai.assert.isEmpty(contactListValues.body);
        });

        it('can list contacts who have attached genVal2', async () => {
            const contactListValues = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${genVal2.id}`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, contacts);
        });

        const txPartiesTemplate: ResolveTransactionPartiesOptions = {
            parties: [],
            currency: currency.code,
            transactionId: "1",
            nonTransactableHandling: "include",
            includeZeroUsesRemaining: true,
            includeZeroBalance: true
        };

        it('can get lightrail transaction plan steps associated with contactA', async () => {
            const contactAsTransactionSource: ResolveTransactionPartiesOptions = {
                ...txPartiesTemplate,
                parties: [
                    {
                        rail: "lightrail",
                        contactId: contactA.id
                    }
                ],
                currency: currency.code,
                transactionId: "1",
                nonTransactableHandling: "include",
                includeZeroUsesRemaining: true,
                includeZeroBalance: true
            };
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, contactAsTransactionSource);
            chai.assert.sameMembers(contactLightrailValues.map(v => (v as LightrailTransactionPlanStep).value.id), valuesAttachedToContactA.map(v => v.id));
        });

        it('can get lightrail transaction plan steps associated with contactB', async () => {
            const contactAsTransactionSource: ResolveTransactionPartiesOptions = {
                ...txPartiesTemplate,
                parties: [
                    {
                        rail: "lightrail",
                        contactId: contactB.id
                    }
                ],
                currency: currency.code,
                transactionId: "1",
                nonTransactableHandling: "include",
                includeZeroUsesRemaining: true,
                includeZeroBalance: true
            };
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, contactAsTransactionSource);
            chai.assert.sameMembers(contactLightrailValues.map(v => (v as LightrailTransactionPlanStep).value.id), valuesAttachedToContactB.map(v => v.id));
        });

        it('can get lightrail transaction plan steps associated with contactA and contactB. Doesnt duplicate shared generic Values.', async () => {
            const contactAsTransactionSource: ResolveTransactionPartiesOptions = {
                ...txPartiesTemplate,
                parties: [
                    {
                        rail: "lightrail",
                        contactId: contactA.id
                    },
                    {
                        rail: "lightrail",
                        contactId: contactB.id
                    }
                ],
                currency: currency.code,
                transactionId: "1",
                nonTransactableHandling: "include",
                includeZeroUsesRemaining: true,
                includeZeroBalance: true
            };
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, contactAsTransactionSource);

            const distinctValues = [...valuesAttachedToContactA, ...valuesAttachedToContactB.filter(v => v.id != genVal2.id)];
            chai.assert.sameMembers(contactLightrailValues.map(v => (v as LightrailTransactionPlanStep).value.id), distinctValues.map(v => v.id));
        });
    });

    it("can't attach generic value using both attach methods (attachNewValue=true first)", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            isGenericCode: true
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        // first, attachNewValue=true attach method succeeds
        const attachNew = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: value.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachNew.statusCode, 200);

        // second, attach without attachNewValue=true fails
        const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(attach.statusCode, 409);
        chai.assert.equal(attach.body.messageCode, "ValueAlreadyAttached");
    });

    it("can't attach generic value using both attach methods (attachNewValue=true second)", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            isGenericCode: true
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        // first, attach
        const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(attach.statusCode, 200);
        const contactValue = await getContactValue(testUtils.defaultTestUser.auth, value.id, contact.id);
        chai.assert.isNotNull(contactValue);

        // second, attach without attachNewValue=true fails
        const attachNew = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: value.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachNew.statusCode, 409);
        chai.assert.equal(attachNew.body.messageCode, "ValueAlreadyAttached");
    });
})
;

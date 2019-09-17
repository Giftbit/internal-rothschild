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
import {generateCode} from "../../utils/codeGenerator";
import chaiExclude = require("chai-exclude");
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {generateUrlSafeHashFromValueIdContactId} from "./genericCodeWithPerContactOptions";

chai.use(chaiExclude);

describe("/v2/contacts/values", () => {

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

    it("can reattach a generic-code Value by code if it was once detached using the propertiesPerContact property", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            }, genericCodeOptions: {
                perContact: {
                    balance: null,
                    usesRemaining: 1
                }
            },
            code: generateFullcode(),
            isGenericCode: true,
            usesRemaining: 20
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

        const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

        const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
        chai.assert.equal(detach.statusCode, 200, `body=${JSON.stringify(detach.body)}`);
        chai.assert.equal(detach.body.contactId, null);

        const getContactValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
        chai.assert.equal(getContactValues.statusCode, 200);
        chai.assert.notInclude(getContactValues.body.map(v => v.id), value.id);

        // Attempting to attach again
        const reattach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
        chai.assert.equal(reattach.statusCode, 200, `body=${JSON.stringify(reattach.body)}`);
        chai.assert.notEqual(reattach.body.contactId, null);
    });

    it("  detach and reattach a generic code using attachGenericAsNewValue flag, uses url safe hash if created date > 2019-06-26", async () => {
        const genericCode: Partial<Value> = {
            id: "324arwesf342aw",
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: generateFullcode(),
            isGenericCode: true
        };
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", genericCode);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        const contact: Partial<Contact> = {
            id: "aw4rd4arwefd",
        };
        const createContactA = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact);
        chai.assert.equal(createContactA.statusCode, 201);

        // manually set createdDate
        const knex = await getKnexWrite();
        await knex.transaction(async trx => {
            const updateRes: number = await trx("Values")
                .where({
                    userId: testUtils.defaultTestUser.userId,
                    id: genericCode.id
                })
                .update({
                    createdDate: "2019-06-26 00:00:01.000" // first second
                });
            if (updateRes === 0) {
                throw new cassava.RestError(404);
            }
            if (updateRes > 1) {
                throw new Error(`Illegal UPDATE query.  Updated ${updateRes} values.`);
            }
        });

        const get = await testUtils.testAuthedRequest<any>(router, `/v2/values/${genericCode.id}`, "GET");
        chai.assert.equal(get.statusCode, 200);
        chai.assert.equal(get.body.createdDate, "2019-06-26T00:00:01.000Z", "Assert createdDate was updated.");

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: createValueResp.body.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, generateUrlSafeHashFromValueIdContactId(genericCode.id, contact.id));
        chai.assert.equal(attachResp.body.id, "F6GljQ2EJiGZAFkHKXuJNPtOkOc", "Specifically checking for string F6GljQ2EJiGZAFkHKXuJNPtOkOc since this is what the hash should return for contactId: aw4rd4arwefd, and valueId: 324arwesf342aw");

        const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: genericCode.id});
        chai.assert.equal(detach.statusCode, 200, `body=${JSON.stringify(detach.body)}`);
        chai.assert.equal(detach.body.contactId, null);
        // Attempting to attach again
        const reattach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: createValueResp.body.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(reattach.statusCode, 200, `body=${JSON.stringify(reattach.body)}`);
    });

    it("can attach a generic-code Value by code", async () => {
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

    describe("attach behaviour for unique code based on JWT", function () {
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

    describe("attach Value in state cases: frozen, cancelled, expired, inactive, usesRemaining=0", function () {
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

                const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attach.statusCode, 409, `body=${JSON.stringify(attach.body)}`);
                chai.assert.equal(attach.body.messageCode, "ValueExpired");
            });
        }
    });

    describe("can list values attached to a contact and contacts who've attach a value", () => {
        let data: AttachedContactValueScenario;
        before(async () => {
            data = await setupAttachedContactValueScenario(router, currency);
        });

        it("can list contacts associated with unique code", async () => {
            const contactListValues = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${data.uniqueValueWithContact.id}`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, data.contacts.filter(contact => contact.id === data.uniqueValueWithContact.contactId));
        });

        it("can list values attached to contactA", async () => {
            const contactListValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${data.contactA.id}/values`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, data.valuesAttachedToContactA);

            const listValuesByContact = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${data.contactA.id}`, "GET");
            chai.assert.sameDeepMembers(listValuesByContact.body, data.valuesAttachedToContactA);

            const listValuesByContactUsingDotEq = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId.eq=${data.contactA.id}`, "GET");
            chai.assert.sameDeepMembers(listValuesByContactUsingDotEq.body, data.valuesAttachedToContactA);

            const listValuesByContactAndIsGenericCodeFalse = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${data.contactA.id}&isGenericCode=false`, "GET");
            chai.assert.sameDeepMembers(listValuesByContactAndIsGenericCodeFalse.body, data.valuesAttachedToContactA.filter(v => v.isGenericCode === false));

            const listValuesByContactAndIsGenericCodeTrue = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${data.contactA.id}&isGenericCode=true`, "GET");
            chai.assert.sameDeepMembers(listValuesByContactAndIsGenericCodeTrue.body, data.valuesAttachedToContactA.filter(v => v.isGenericCode === true));

            const listValuesByContactAndIsCode = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${data.contactA.id}&code=${data.genVal1_attachGenericAsNewValue.code}`, "GET");
            chai.assert.sameDeepMembers(listValuesByContactAndIsCode.body, data.valuesAttachedToContactA.filter(v => v.id === data.genVal1_attachGenericAsNewValue.id));
        });

        it("can list values attached to contactB", async () => {
            const contactListValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${data.contactB.id}/values`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, data.valuesAttachedToContactB);

            const listValuesByContact = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${data.contactB.id}`, "GET");
            chai.assert.sameDeepMembers(listValuesByContact.body, data.valuesAttachedToContactB);
        });

        it("can list contacts who have attached genVal1 but returns none since genericValue1 was attached as new Values", async () => {
            const contactListValues = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${data.genVal1_attachGenericAsNewValue.id}`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, data.contacts);
        });

        it("can list contacts who have attached genVal2", async () => {
            const contactListValues = await testUtils.testAuthedRequest<Contact[]>(router, `/v2/contacts?valueId=${data.genVal2_sharedGenericValue.id}`, "GET");
            chai.assert.sameDeepMembers(contactListValues.body, data.contacts);
        });
    });

    describe("detach", () => {
        it("can detach using generic valueId", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                },
                balanceRule: {
                    rule: "500 + value.balanceChange",
                    explanation: "$5.00 off order"
                },
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
            chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 200, `body=${JSON.stringify(detach.body)}`);
            chai.assert.equal(detach.body.contactId, null);

            const getContactValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
            chai.assert.equal(getContactValues.statusCode, 200);
            chai.assert.notInclude(getContactValues.body.map(v => v.id), value.id);
        });

        it("can detach Value", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
            chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 200, `body=${JSON.stringify(detach.body)}`);
            chai.assert.deepEqualExcluding(detach.body, createValue.body, ["updatedContactIdDate", "updatedDate"]);

            const getValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value.id}`, "GET");
            chai.assert.equal(getValue.statusCode, 200);
            chai.assert.deepEqualExcluding(createValue.body, getValue.body, ["updatedContactIdDate", "updatedDate"]);
        });

        it("can detach Generic Value", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
                isGenericCode: true,
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
            chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 200, `body=${JSON.stringify(detach.body)}`);
            chai.assert.deepEqual(detach.body, createValue.body);

            const getContactValues = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
            chai.assert.equal(getContactValues.statusCode, 200);
            chai.assert.notInclude(getContactValues.body.map(v => v.id), value.id);
        });

        it("can't detach a Value that a Contact doesn't have attached", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 409, `body=${JSON.stringify(detach.body)}`);
            chai.assert.equal(detach.body.messageCode, "AttachedValueNotFound");
        });

        it("can't detach a Generic Value that a Contact doesn't have attached", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
                isGenericCode: true
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 409, `body=${JSON.stringify(detach.body)}`);
            chai.assert.equal(detach.body.messageCode, "AttachedValueNotFound");
        });

        it("can't detach frozen Values", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
                isGenericCode: true
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
            chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const freeze = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "PATCH", {frozen: true});
            chai.assert.equal(freeze.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 409, `body=${JSON.stringify(detach.body)}`);
            chai.assert.equal(detach.body.messageCode, "ValueFrozen");
        });

        it("can detach canceled Values", async () => {
            const value: Partial<Value> = {
                id: generateId(),
                currency: currency.code,
                isGenericCode: true
            };
            const createValue = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
            chai.assert.equal(createValue.statusCode, 201, `body=${JSON.stringify(createValue.body)}`);

            const attach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
            chai.assert.equal(attach.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const cancel = await testUtils.testAuthedRequest<any>(router, `/v2/values/${value.id}`, "PATCH", {canceled: true});
            chai.assert.equal(cancel.statusCode, 200, `body=${JSON.stringify(attach.body)}`);

            const detach = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/detach`, "POST", {valueId: value.id});
            chai.assert.equal(detach.statusCode, 200, `body=${JSON.stringify(detach.body)}`);
        });
    });
});

export interface AttachedContactValueScenario {
    contactA: Partial<Contact>;
    contactB: Partial<Contact>;
    contacts: Contact[];
    valuesAttachedToContactA: Value[];
    valuesAttachedToContactB: Value[];
    uniqueValueWithContact: Partial<Value>;
    uniqueValue: Partial<Value>;
    genVal1_attachGenericAsNewValue: Partial<Value>;
    genVal2_sharedGenericValue: Partial<Value>;
    genVal3_perContactProperties: Partial<Value>;
}

export async function setupAttachedContactValueScenario(router: cassava.Router, currency: Currency) {
    const contactAId = generateId(5) + "A";
    const data: AttachedContactValueScenario = {
        contactA: {
            id: contactAId,
            firstName: "A",
        },
        contactB: {
            id: generateId(5) + "B",
            firstName: "B",
        },
        contacts: [],
        valuesAttachedToContactA: [],
        valuesAttachedToContactB: [],
        uniqueValueWithContact: {
            id: generateId(5) + "unique-belongsToA",
            currency: currency.code,
            contactId: contactAId
        },
        uniqueValue: {
            id: generateId(5) + "-unique-attachToA",
            currency: currency.code,
        },
        genVal1_attachGenericAsNewValue: {
            id: generateId(5) + "-GEN1",
            currency: currency.code,
            code: generateCode({}),
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
        },
        genVal2_sharedGenericValue: {
            id: generateId(5) + "-GEN2",
            currency: currency.code,
            isGenericCode: true,
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
        },
        genVal3_perContactProperties: {
            id: generateId(5) + "-GEN3",
            currency: currency.code,
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: null,
                    usesRemaining: 1
                }
            },
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
        }
    };

    const createContactA = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", data.contactA);
    chai.assert.equal(createContactA.statusCode, 201);
    data.contacts.push(createContactA.body);
    const createContactB = await testUtils.testAuthedRequest<Contact>(router, `/v2/contacts`, "POST", data.contactB);
    chai.assert.equal(createContactB.statusCode, 201);
    data.contacts.push(createContactB.body);

    // create genericVal1
    const createGenericVal1 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", data.genVal1_attachGenericAsNewValue);
    chai.assert.equal(createGenericVal1.statusCode, 201);

    // create a genericVal2
    const createGenVal2 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", data.genVal2_sharedGenericValue);
    chai.assert.equal(createGenVal2.statusCode, 201);
    chai.assert.isNull(createGenVal2.body.genericCodeOptions);

    // create a genericVal3
    const createGenVal3 = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", data.genVal3_perContactProperties);
    chai.assert.equal(createGenVal3.statusCode, 201);
    chai.assert.deepEqual(createGenVal3.body.genericCodeOptions, data.genVal3_perContactProperties.genericCodeOptions);

    /** ContactA Attached Values **/
        // unique value created with contactId set to ContactA
    const createUniqueValueWithContact = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", data.uniqueValueWithContact);
    chai.assert.equal(createUniqueValueWithContact.statusCode, 201);
    data.valuesAttachedToContactA.push(createUniqueValueWithContact.body);

    // attach unique value to ContactA
    const createUniqueValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", data.uniqueValue);
    chai.assert.equal(createUniqueValue.statusCode, 201);

    const attachUniqueValue = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${data.contactA.id}/values/attach`, "POST", {valueId: data.uniqueValue.id});
    chai.assert.equal(attachUniqueValue.statusCode, 200);
    data.valuesAttachedToContactA.push(attachUniqueValue.body);

    // attach genericVal1 to ContactA as new Value
    const attachNew_genVal1_contactA = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${data.contactA.id}/values/attach`, "POST", {
        valueId: data.genVal1_attachGenericAsNewValue.id,
        attachGenericAsNewValue: true
    });
    chai.assert.equal(attachNew_genVal1_contactA.statusCode, 200);
    data.valuesAttachedToContactA.push(attachNew_genVal1_contactA.body /* new value from attach */);

    // attach genVal2 to ContactA
    const attach_genVal2_contactA = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${data.contactA.id}/values/attach`, "POST", {valueId: data.genVal2_sharedGenericValue.id});
    chai.assert.equal(attach_genVal2_contactA.statusCode, 200);
    data.valuesAttachedToContactA.push(createGenVal2.body /* original value attached */);

    // attach genVal3 to ContactA
    const attach_genVal3_contactA = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${data.contactA.id}/values/attach`, "POST", {valueId: data.genVal3_perContactProperties.id});
    chai.assert.equal(attach_genVal3_contactA.statusCode, 200);
    data.valuesAttachedToContactA.push(attach_genVal3_contactA.body /* new value attached with per contact properties */);

    /** ContactB Attached Values **/
    const attachNew_genVal1_contactB = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${data.contactB.id}/values/attach`, "POST", {
        valueId: data.genVal1_attachGenericAsNewValue.id,
        attachGenericAsNewValue: true
    });
    chai.assert.equal(attachNew_genVal1_contactB.statusCode, 200);
    data.valuesAttachedToContactB.push(attachNew_genVal1_contactB.body /* new value from attach */);

    const attach_genVal2_contactB = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${data.contactB.id}/values/attach`, "POST", {valueId: data.genVal2_sharedGenericValue.id});
    chai.assert.equal(attach_genVal2_contactB.statusCode, 200);
    data.valuesAttachedToContactB.push(createGenVal2.body /* original value attached */);

    return data;
}

import * as cassava from "cassava";
import * as chai from "chai";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Contact} from "../../model/Contact";
import {installRestRoutes} from "./installRestRoutes";
import * as testUtils from "../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {createContact} from "./contacts";
import {Currency} from "../../model/Currency";
import {createCurrency} from "./currencies";
import {Value} from "../../model/Value";
import {Transaction} from "../../model/Transaction";

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

    let value1: Value;

    it("can attach a code-less Value by valueId", async () => {
        const resp1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-code-less-by-id",
            currency: currency.code
        });
        chai.assert.equal(resp1.statusCode, 201, `body=${JSON.stringify(resp1.body)}`);
        value1 = resp1.body;

        const resp2 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value1.id});
        chai.assert.equal(resp2.statusCode, 200, `body=${JSON.stringify(resp2.body)}`);
        chai.assert.equal(resp2.body.id, value1.id);
        chai.assert.equal(resp2.body.contactId, contact.id);
        chai.assert.isNotNull(resp2.body.updatedContactIdDate);
        chai.assert.equal(resp2.body.updatedContactIdDate, resp2.body.updatedDate);
        value1 = resp2.body;
    });

    let value2: Value;

    it("can attach a generic-code Value by valueId", async () => {
        const code = "GETONUP";
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-by-id",
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: code,
            isGenericCode: true
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: createValueResp.body.id});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.currency, createValueResp.body.currency);
        chai.assert.deepEqual(attachResp.body.balanceRule, createValueResp.body.balanceRule);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.usesRemaining, 1);
        chai.assert.equal(attachResp.body.code, null);
        chai.assert.equal(attachResp.body.isGenericCode, false);
        chai.assert.notEqual(attachResp.body.id, createValueResp.body.id);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
        chai.assert.equal(attachResp.body.createdBy, testUtils.defaultTestUser.auth.teamMemberId);
        value2 = attachResp.body;

        // Should be a transaction for the attach.
        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${attachResp.body.id}`, "GET");
        chai.assert.equal(getTxResp.statusCode, 200, `there should be a transaction for the attach body=${JSON.stringify(attachResp.body)}`);
        chai.assert.deepEqual(getTxResp.body, {
            id: attachResp.body.id,
            transactionType: "attach",
            currency: attachResp.body.currency,
            steps: [
                {
                    rail: "lightrail",
                    valueId: createValueResp.body.id,
                    contactId: null,
                    code: null,
                    balanceBefore: null,
                    balanceAfter: null,
                    balanceChange: 0,
                    usesRemainingBefore: null,
                    usesRemainingAfter: null,
                    usesRemainingChange: null
                },
                {
                    rail: "lightrail",
                    valueId: attachResp.body.id,
                    contactId: attachResp.body.contactId,
                    code: null,
                    balanceBefore: null,
                    balanceAfter: null,
                    balanceChange: 0,
                    usesRemainingBefore: 0,
                    usesRemainingAfter: 1,
                    usesRemainingChange: 1
                }
            ],
            totals: null,
            lineItems: null,
            paymentSources: null,
            createdDate: attachResp.body.createdDate,
            createdBy: attachResp.body.createdBy,
            metadata: null,
            tax: null
        });
    });

    const value3Code = "GETONDOWN";
    let value3: Value;

    it("can attach a generic-code Value by code", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-by-code",
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: value3Code,
            isGenericCode: true,
            usesRemaining: 20
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value3Code});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.currency, createValueResp.body.currency);
        chai.assert.deepEqual(attachResp.body.balanceRule, createValueResp.body.balanceRule);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.usesRemaining, 1);
        chai.assert.equal(attachResp.body.code, null);
        chai.assert.equal(attachResp.body.isGenericCode, false);
        chai.assert.notEqual(attachResp.body.id, createValueResp.body.id);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
        value3 = attachResp.body;

        // usesRemaining should be decremented on original Value.
        const getValueResp = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueResp.body.id}`, "GET");
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.usesRemaining, createValueResp.body.usesRemaining - 1);

        // Should be a transaction for the attach.
        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${attachResp.body.id}`, "GET");
        chai.assert.equal(getTxResp.statusCode, 200, `there should be a transaction for the attach body=${JSON.stringify(attachResp.body)}`);
        chai.assert.deepEqual(getTxResp.body, {
            id: attachResp.body.id,
            transactionType: "attach",
            currency: attachResp.body.currency,
            steps: [
                {
                    rail: "lightrail",
                    valueId: createValueResp.body.id,
                    contactId: null,
                    code: null,
                    balanceBefore: null,
                    balanceAfter: null,
                    balanceChange: 0,
                    usesRemainingBefore: createValueResp.body.usesRemaining,
                    usesRemainingAfter: createValueResp.body.usesRemaining - 1,
                    usesRemainingChange: -1
                },
                {
                    rail: "lightrail",
                    valueId: attachResp.body.id,
                    contactId: attachResp.body.contactId,
                    code: null,
                    balanceBefore: null,
                    balanceAfter: null,
                    balanceChange: 0,
                    usesRemainingBefore: 0,
                    usesRemainingAfter: 1,
                    usesRemainingChange: 1
                }
            ],
            totals: null,
            lineItems: null,
            paymentSources: null,
            createdDate: attachResp.body.createdDate,
            createdBy: attachResp.body.createdBy,
            metadata: null,
            tax: null
        });
    });

    const value4Code = "GETYOURFREAKON";
    let value4: Value;

    it("can attach a generic-code Value with a balance", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generic-with-balance",
            currency: currency.code,
            balance: 500,
            code: value4Code,
            isGenericCode: true,
            usesRemaining: 135
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value4Code});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.currency, createValueResp.body.currency);
        chai.assert.deepEqual(attachResp.body.balance, createValueResp.body.balance);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.usesRemaining, 1);
        chai.assert.equal(attachResp.body.code, null);
        chai.assert.equal(attachResp.body.isGenericCode, false);
        chai.assert.notEqual(attachResp.body.id, createValueResp.body.id);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
        value4 = attachResp.body;

        // usesRemaining should be decremented on original Value and balance unchanged.
        const getValueResp = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueResp.body.id}`, "GET");
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, createValueResp.body.balance);
        chai.assert.equal(getValueResp.body.usesRemaining, createValueResp.body.usesRemaining - 1);

        // Should be a transaction for the attach.
        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${attachResp.body.id}`, "GET");
        chai.assert.equal(getTxResp.statusCode, 200, `there should be a transaction for the attach body=${JSON.stringify(attachResp.body)}`);
        chai.assert.deepEqual(getTxResp.body, {
            id: attachResp.body.id,
            transactionType: "attach",
            currency: attachResp.body.currency,
            steps: [
                {
                    rail: "lightrail",
                    valueId: createValueResp.body.id,
                    contactId: null,
                    code: null,
                    balanceBefore: createValueResp.body.balance,
                    balanceAfter: createValueResp.body.balance,
                    balanceChange: 0,
                    usesRemainingBefore: createValueResp.body.usesRemaining,
                    usesRemainingAfter: createValueResp.body.usesRemaining - 1,
                    usesRemainingChange: -1
                },
                {
                    rail: "lightrail",
                    valueId: attachResp.body.id,
                    contactId: attachResp.body.contactId,
                    code: null,
                    balanceBefore: 0,
                    balanceAfter: createValueResp.body.balance,
                    balanceChange: createValueResp.body.balance,
                    usesRemainingBefore: 0,
                    usesRemainingAfter: 1,
                    usesRemainingChange: 1
                }
            ],
            totals: null,
            lineItems: null,
            paymentSources: null,
            createdDate: attachResp.body.createdDate,
            createdBy: attachResp.body.createdBy,
            metadata: null,
            tax: null
        });
    });

    it("a Contact cannot claim a generic-code Value twice", async () => {
        const resp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value3Code});
        chai.assert.equal(resp.statusCode, 409, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.messageCode, "ValueAlreadyAttached");
    });

    it("cannot attach a generic-code Value with 0 usesRemaining", async () => {
        const code = "PARTYPEOPLE";
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "generic-value-with-0-uses",
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: code,
            isGenericCode: true,
            usesRemaining: 0
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: code});
        chai.assert.equal(attachResp.statusCode, 409, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.messageCode, "InsufficientUsesRemaining");
    });

    const value5Code = "DROPITLIKEITSHOT";
    let value5: Value;

    it("can attach a unique-code Value by valueId", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-unique-by-id",
            currency: currency.code,
            code: value5Code
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);
        value5 = createValueResp.body;

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value5.id});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, value5.id);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.code, `…${value5Code.slice(-4)}`);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
        value5 = attachResp.body;
    });

    const value6Code = "ANDPICKITBACKUP";
    let value6: Value;

    it("can attach a unique-code Value by code", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-unique-by-code",
            currency: currency.code,
            code: value6Code
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);
        value6 = createValueResp.body;

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value6Code});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, value6.id);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.code, `…${value6Code.slice(-4)}`);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
        value6 = attachResp.body;
    });

    let value7Code: string;
    let value7: Value;

    it("can attach a unique-generated-code Value by code", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "add-generated-by-code",
            currency: currency.code,
            generateCode: {
                length: 12
            }
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);
        value7 = createValueResp.body;

        const getCodeResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value7.id}?showCode=true`, "GET");
        chai.assert.equal(getCodeResp.statusCode, 200, `body=${JSON.stringify(getCodeResp.body)}`);
        value7Code = getCodeResp.body.code;

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {code: value7Code});
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.id, value7.id);
        chai.assert.equal(attachResp.body.contactId, contact.id);
        chai.assert.equal(attachResp.body.code, `…${value7Code.slice(-4)}`);
        chai.assert.isNotNull(attachResp.body.updatedContactIdDate);
        chai.assert.equal(attachResp.body.updatedContactIdDate, attachResp.body.updatedDate);
        value7 = attachResp.body;
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

    it("can list values attached to a contact", async () => {
        const resp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.sameDeepMembers(resp.body, [value1, value2, value3, value4, value5, value6, value7]);
    });

    it("can list values attached to a contact with showCode = true", async () => {
        const resp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contact.id}/values?showCode=true`, "GET");
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);

        chai.assert.isObject(resp.body.find(v => v.code === value5Code), "find a Value with decrypted value5Code");
        chai.assert.isObject(resp.body.find(v => v.code === value6Code), "find a Value with decrypted value6Code");
        chai.assert.isObject(resp.body.find(v => v.code === value7Code), "find a Value with decrypted value7Code");
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
            body: JSON.stringify({code: value7Code})
        }));
        chai.assert.equal(resp.statusCode, 409, `body=${resp.body}`);
        chai.assert.equal(JSON.parse(resp.body).messageCode, "ValueNotFound", `body=${resp.body}`);
    });

    it("can attach an already attached value using a plain JWT", async () => {
        const resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact2.id}/values/attach`, "POST", {code: value7Code});
        chai.assert.equal(resp.statusCode, 200, `body=${JSON.stringify(resp.body)}`);
        chai.assert.equal(resp.body.id, value7.id);
        chai.assert.equal(resp.body.contactId, contact2.id);
        chai.assert.equal(resp.body.code, `…${value7Code.slice(-4)}`);
        chai.assert.isNotNull(resp.body.updatedContactIdDate);
        chai.assert.equal(resp.body.updatedContactIdDate, resp.body.updatedDate);
        value7.contactId = contact2.id;
    });

    let value8: Value;

    it("cannot attach a frozen Value", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "gonna-freeze-this",
            currency: currency.code
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);
        value8 = createValueResp.body;

        const freezeResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value8.id}`, "PATCH", {
            frozen: true
        });
        chai.assert.equal(freezeResp.statusCode, 200, `body=${JSON.stringify(freezeResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value8.id});
        chai.assert.equal(attachResp.statusCode, 409, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.messageCode, "ValueFrozen");
    });

    let value9: Value;

    it("cannot attach a canceled Value", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "gonna-cancel-this",
            currency: currency.code
        });
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);
        value9 = createValueResp.body;

        const cancelResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value9.id}`, "PATCH", {
            canceled: true
        });
        chai.assert.equal(cancelResp.statusCode, 200, `body=${JSON.stringify(cancelResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value9.id});
        chai.assert.equal(attachResp.statusCode, 409, `body=${JSON.stringify(attachResp.body)}`);
        chai.assert.equal(attachResp.body.messageCode, "ValueCanceled");
    });

    it("can attach a value with attachGenericAsNewValue=true flag", async () => {
        let value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            isGenericCode: true
        };
        const createValue = await testUtils.testAuthedRequest<Value>(router, `/v2/values`, "POST", value);
        chai.assert.equal(createValue.statusCode, 201);

        const attach = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: value.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attach.statusCode, 200);
        chai.assert.notEqual(value.id, attach.body.id);
    });
});

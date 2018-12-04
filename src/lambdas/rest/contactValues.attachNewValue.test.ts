import * as cassava from "cassava";
import {Contact} from "../../model/Contact";
import {installRestRoutes} from "./installRestRoutes";
import * as testUtils from "../../utils/testUtils";
import {generateFullcode, generateId, setCodeCryptographySecrets} from "../../utils/testUtils";
import {Currency} from "../../model/Currency";
import {createCurrency} from "./currencies";
import * as chai from "chai";
import {Value} from "../../model/Value";
import {Transaction} from "../../model/Transaction";

describe("/v2/contacts/values - attachNewValue=true", () => {

    const router = new cassava.Router();

    const currency: Currency = {
        code: "USD",
        decimalPlaces: 2,
        symbol: "$",
        name: "US Dollars"
    };

    let contact: Contact;

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, currency);

        const contactPartial: Partial<Contact> = {
            id: generateId(),
            firstName: "a"
        };
        const createContactA = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contactPartial);
        chai.assert.equal(createContactA.statusCode, 201);
        contact = createContactA.body;
    });

    it("can attach a generic-code Value by valueId using attachNewValue=true to create a new Value", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balanceRule: {
                rule: "500",
                explanation: "$5 done the hard way"
            },
            code: generateFullcode(),
            isGenericCode: true
        };
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            valueId: createValueResp.body.id,
            attachGenericAsNewValue: true
        });
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

        // Should be a transaction for the attach.
        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${encodeURIComponent(attachResp.body.id)}`, "GET");
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

    it("can attach a generic-code Value by code using attachNewValue=true to create a new Value", async () => {
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

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            code: value.code,
            attachGenericAsNewValue: true
        });
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

        // usesRemaining should be decremented on original Value.
        const getValueResp = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueResp.body.id}`, "GET");
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.usesRemaining, createValueResp.body.usesRemaining - 1);

        // Should be a transaction for the attach.
        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${encodeURIComponent(attachResp.body.id)}`, "GET");
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

    it("can attach a generic-code Value with a balance using attachNewValue=true to create a new Value", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            balance: 500,
            code: generateFullcode(),
            isGenericCode: true,
            usesRemaining: 135
        };

        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        // Should return a new Value.
        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            code: value.code,
            attachGenericAsNewValue: true
        });
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

        // usesRemaining should be decremented on original Value and balance unchanged.
        const getValueResp = await await testUtils.testAuthedRequest<Value>(router, `/v2/values/${createValueResp.body.id}`, "GET");
        chai.assert.equal(attachResp.statusCode, 200, `body=${JSON.stringify(getValueResp.body)}`);
        chai.assert.equal(getValueResp.body.balance, createValueResp.body.balance);
        chai.assert.equal(getValueResp.body.usesRemaining, createValueResp.body.usesRemaining - 1);

        // Should be a transaction for the attach.
        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${encodeURIComponent(attachResp.body.id)}`, "GET");
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

    it("a Contact cannot attach a generic-code Value twice using attachNewValue=true to create a new Value", async () => {
        const value: Partial<Value> = {
            id: generateId(),
            currency: currency.code,
            code: generateFullcode(),
            balance: 500,
            isGenericCode: true,
            usesRemaining: 135
        };

        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value);
        chai.assert.equal(createValueResp.statusCode, 201, `body=${JSON.stringify(createValueResp.body)}`);

        const attachResp1 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            code: value.code,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachResp1.statusCode, 200, `body=${JSON.stringify(attachResp1.body)}`);

        const attachResp2 = await testUtils.testAuthedRequest<any>(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {
            code: value.code,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachResp2.statusCode, 409, `body=${JSON.stringify(attachResp2.body)}`);
        chai.assert.equal(attachResp2.body.messageCode, "ValueAlreadyAttached");
    });
});

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
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {generateUrlSafeHashFromValueIdContactId} from "./genericCodeWithPerContactOptions";
import {CheckoutRequest} from "../../model/TransactionRequest";

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
            pending: false,
            createdDate: attachResp.body.createdDate,
            createdBy: attachResp.body.createdBy,
            metadata: null,
            tax: null
        });
    });

    it("can attach a generic code using attachGenericAsNewValue flag, uses url safe hash if created date > 2019-06-26", async () => {
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
            pending: false,
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
            pending: false,
            createdDate: attachResp.body.createdDate,
            createdBy: attachResp.body.createdBy,
            metadata: null,
            tax: null
        });
    });

    describe("stats on generic code with usesRemaining liability", () => {
        const contactForStatsTest = generateId();

        const genericValue: Partial<Value> = {
            id: generateId(),
            currency: "USD",
            isGenericCode: true,
            code: generateFullcode(),
            discount: true,
            balance: 400,
            usesRemaining: 4 // can be attached 4 times
        };

        before(async function () {
            const createContact1 = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactForStatsTest});
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
                uses: 2, // effectively reduces attaches remaining by 2
                currency: "USD"
            });
            chai.assert.equal(debit.statusCode, 201);

            // attach to contact as new Value
            const attachResp1 = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactForStatsTest}/values/attach`, "POST", {
                code: genericValue.code,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attachResp1.statusCode, 200, `body=${JSON.stringify(attachResp1.body)}`);

            // do checkout
            const checkoutRequest: CheckoutRequest = {
                id: generateId(),
                currency: "USD",
                sources: [
                    {rail: "lightrail", contactId: contactForStatsTest}
                ],
                lineItems: [
                    {unitPrice: 400}
                ]
            };
            const checkout = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", checkoutRequest);
            chai.assert.equal(checkout.statusCode, 201, `Response: ${JSON.stringify(checkout.body)}`);

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
});

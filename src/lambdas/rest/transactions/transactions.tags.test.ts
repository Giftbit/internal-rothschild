import * as chai from "chai";
import chaiExclude from "chai-exclude";
import * as cassava from "cassava";
import * as testUtils from "../../../utils/testUtils";
import {installRestRoutes} from "../installRestRoutes";
import {Value} from "../../../model/Value";
import {Contact} from "../../../model/Contact";
import {Transaction} from "../../../model/Transaction";
import {CheckoutRequest} from "../../../model/TransactionRequest";
import {getKnexRead} from "../../../utils/dbUtils/connection";
import {Tag} from "../../../model/Tag";
import {formatContactIdTags} from "./transactions";
import {setStubsForStripeTests, unsetStubsForStripeTests} from "../../../utils/testUtils/stripeTestUtils";
import {after} from "mocha";
import * as sinon from "sinon";
import * as InsertTransactions from "./insertTransactions";
import log = require("loglevel");
import {LightrailTransactionStep} from "../../../model/TransactionStep";

chai.use(chaiExclude);

describe("/v2/transactions - tags", () => {
    const router = new cassava.Router();

    const contact1: Partial<Contact> = {
        id: "contact1"
    };
    const value1: Partial<Value> = {
        id: "value-1",
        contactId: contact1.id,
        currency: "USD",
        balanceRule: {rule: "1000", explanation: "1000"},
        balance: null
    };
    const value2: Partial<Value> = {
        id: "value-2",
        contactId: contact1.id,
        currency: "USD",
        balance: 5000
    };
    const value3: Partial<Value> = {
        id: "value-3",
        contactId: contact1.id,
        currency: "USD",
        balance: 5000
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);

        await testUtils.createUSD(router);
        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact1);
        chai.assert.equal(contactResp.statusCode, 201);
        await testUtils.createUSDValue(router, value1);
        await testUtils.createUSDValue(router, value2);
        await testUtils.createUSDValue(router, value3);
    });

    describe("checkouts", () => {
        it("tags tx with contactId: unique attached value as source", async () => {
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-uq-attached-value",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", valueId: value1.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            assertTxHasContactIdTags(resp.body, [contact1.id]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqual(getTxResp.body, resp.body);
        });

        it("tags tx with contactId: unique attached value as source: value not charged", async () => {
            const zeroBalanceValue = await testUtils.createUSDValue(router, {
                balance: 0,
                contactId: contact1.id
            });
            const unattachedValue = await testUtils.createUSDValue(router);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-uq-attached-value-0-balance",
                currency: "USD",
                lineItems: [{unitPrice: 50}],
                sources: [{
                    rail: "lightrail", valueId: zeroBalanceValue.id
                }, {
                    rail: "lightrail",
                    valueId: unattachedValue.id
                }]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            assertTxHasContactIdTags(resp.body, [contact1.id]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqual(getTxResp.body, resp.body);
        });

        it("tags tx with contactId: contactId as source", async () => {
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-cid",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: contact1.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            assertTxHasContactIdTags(resp.body, [contact1.id]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqual(getTxResp.body, resp.body);
        });

        it("tags tx with contactId: 2nd contactId as source, doesn't get used", async () => {
            const contact2: Partial<Contact> = {id: "contact2"};
            const contact2Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact2);
            chai.assert.equal(contact2Resp.statusCode, 201, `contact2Resp.body=${JSON.stringify(contact2Resp.body)}`);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-2cid",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", valueId: value1.id}, {rail: "lightrail", contactId: contact2.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            assertTxHasContactIdTags(resp.body, [contact1.id, contact2.id]);
        });

        it("tags tx with contactId: 2nd unique value (attached to different contact) as source, doesn't get used", async () => {
            const newContact: Partial<Contact> = {id: testUtils.generateId(5)};
            const newContactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", newContact);
            chai.assert.equal(newContactResp.statusCode, 201, `newContactResp.body=${JSON.stringify(newContactResp.body)}`);
            const newValue: Partial<Value> = {
                id: testUtils.generateId(5),
                currency: "USD",
                balance: 0,
                contactId: newContact.id
            };
            const newValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", newValue);
            chai.assert.equal(newValueResp.statusCode, 201, `newValueResp.body=${JSON.stringify(newValueResp)}`);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-2uq-attached",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", valueId: value1.id}, {rail: "lightrail", valueId: newValue.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            assertTxHasContactIdTags(resp.body, [contact1.id, newContact.id]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqualExcluding(getTxResp.body, resp.body, ["tags"]);
            chai.assert.sameDeepMembers(getTxResp.body.tags, resp.body.tags);
        });

        it("tags tx with contactId: contactId that doesn't exist as source", async () => {
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-nonexistent-cid",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: "gibberish"}, {rail: "lightrail", valueId: value1.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            assertTxHasContactIdTags(resp.body, [contact1.id, "gibberish"]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqualExcluding(getTxResp.body, resp.body, ["tags"]);
            chai.assert.sameDeepMembers(getTxResp.body.tags, resp.body.tags);
        });

        it("does not tag tx: no contacts involved in checkout", async () => {
            const newValue = await testUtils.createUSDValue(router);
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-no-contacts",
                currency: "USD",
                lineItems: [{unitPrice: 50}],
                sources: [{rail: "lightrail", valueId: newValue.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isUndefined(resp.body.tags, `transaction should have no contactId tags: ${JSON.stringify(resp.body)}`);
        });

        it("tags tx with contactId: checkout with attached shared generic code", async () => { // todo this can probably go away, see tim's deprecation
            const sharedGeneric: Partial<Value> = {
                id: "shared-generic",
                isGenericCode: true,
                currency: "USD",
                balanceRule: {
                    rule: "1000",
                    explanation: "1000"
                },
                balance: null
            };
            await testUtils.createUSDValue(router, sharedGeneric);

            const newContact: Partial<Contact> = {id: `new-contact-${testUtils.generateId(4)}`};
            const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", newContact);
            chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp)}`);

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${newContact.id}/values/attach`, "POST", {
                valueId: sharedGeneric.id
            });
            chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-w-shared-generic",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{
                    rail: "lightrail",
                    valueId: sharedGeneric.id
                }, {
                    rail: "lightrail",
                    contactId: newContact.id
                }]
            });
            chai.assert.equal(checkoutResp.statusCode, 201, `checkoutResp.body=${JSON.stringify(checkoutResp.body)}`);
            assertTxHasContactIdTags(checkoutResp.body, [newContact.id]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutResp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqual(getTxResp.body, checkoutResp.body);
        });
    });

    describe("attach transactions", () => {
        it("adds contactId tag to both the checkout and the attach transaction if auto-attach is used", async () => {
            const newContact: Partial<Contact> = {id: `new-contact-${testUtils.generateId(4)}`};
            const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", newContact);
            chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp)}`);

            const perContactValue1: Partial<Value> = {
                id: "gen-val-per-contact-1",
                currency: "USD",
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 100,
                        usesRemaining: null
                    }
                }
            };
            const v1SetupResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", perContactValue1);
            chai.assert.equal(v1SetupResp.statusCode, 201, `v1SetupResp.body=${JSON.stringify(v1SetupResp.body)}`);

            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-w-auto-attach",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{
                    rail: "lightrail",
                    valueId: perContactValue1.id
                }, {
                    rail: "lightrail",
                    contactId: newContact.id
                }]
            });
            chai.assert.equal(checkoutResp.statusCode, 201, `checkoutResp.body=${JSON.stringify(checkoutResp.body)}`);
            assertTxHasContactIdTags(checkoutResp.body, [newContact.id]);

            const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutResp.body.id}`, "GET");
            chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
            chai.assert.deepEqual(getTxResp.body, checkoutResp.body);

            const getAttachTxResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?transactionType=attach&valueId=${perContactValue1.id}`, "GET");
            chai.assert.equal(getAttachTxResp.statusCode, 200, `getAttachTxResp.body=${JSON.stringify(getAttachTxResp)}`);
            chai.assert.equal(getAttachTxResp.body.length, 1, `getAttachTxResp.body=${JSON.stringify(getAttachTxResp)}`);
            assertTxHasContactIdTags(getAttachTxResp.body[0], [newContact.id]);
        });

        it("adds contactId tag to attach transaction when the /attach endpoint is used for a value with perContact properties", async () => {
            const genericValue = await testUtils.createUSDValue(router, {
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 1,
                        usesRemaining: null
                    }
                }
            });

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
                valueId: genericValue.id
            });
            chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);

            const attachTxResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${genericValue.id}&transactionType=attach`, "GET");
            chai.assert.equal(attachTxResp.statusCode, 200, `attachTxResp.body=${JSON.stringify(attachTxResp.body)}`);
            assertTxHasContactIdTags(attachTxResp.body[0], [contact1.id]);
        });

        it("adds contactId tag to attach transaction when using legacy 'attachGenericAsNewValue' flag", async () => {
            const sharedGenericValue = await testUtils.createUSDValue(router, {
                isGenericCode: true,
                balance: null,
                balanceRule: {
                    rule: "500",
                    explanation: "$5"
                }
            });

            const attachSharedResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
                valueId: sharedGenericValue.id,
                attachGenericAsNewValue: true
            });
            chai.assert.equal(attachSharedResp.statusCode, 200, `attachSharedResp.body=${JSON.stringify(attachSharedResp.body)}`);

            const attachSharedTxResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?valueId=${sharedGenericValue.id}&transactionType=attach`, "GET");
            chai.assert.equal(attachSharedTxResp.statusCode, 200, `attachSharedTxResp.body=${JSON.stringify(attachSharedTxResp.body)}`);
            chai.assert.equal(attachSharedTxResp.body.length, 1, `attachSharedTxResp.body=${JSON.stringify(attachSharedTxResp.body)}`);
            assertTxHasContactIdTags(attachSharedTxResp.body[0], [contact1.id]);
        });
    });

    it("adds contactId tag when creating a credit transaction", async () => {
        const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
            id: "credit",
            currency: "USD",
            amount: 100,
            destination: {
                rail: "lightrail",
                valueId: value2.id
            }
        });
        chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
        assertTxHasContactIdTags(resp.body, [contact1.id]);

        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
        chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
        chai.assert.deepEqual(getTxResp.body, resp.body);
    });

    it("adds contactId tag when creating a debit transaction", async () => {
        const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
            id: "debit",
            currency: "USD",
            amount: 100,
            source: {
                rail: "lightrail",
                valueId: value2.id
            }
        });
        chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

        assertTxHasContactIdTags(resp.body, [contact1.id]);

        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
        chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
        chai.assert.deepEqual(getTxResp.body, resp.body);
    });

    it("adds contactId tag when creating a transfer transaction", async () => {
        const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
            id: "transfer",
            currency: "USD",
            amount: 100,
            source: {
                rail: "lightrail",
                valueId: value2.id
            },
            destination: {
                rail: "lightrail",
                valueId: value3.id
            }
        });
        chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

        assertTxHasContactIdTags(resp.body, [contact1.id]);

        const getTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${resp.body.id}`, "GET");
        chai.assert.equal(getTxResp.statusCode, 200, `getTxResp.body=${JSON.stringify(getTxResp)}`);
        chai.assert.deepEqual(getTxResp.body, resp.body);
    });

    describe("transactions later in chain: reverse, capture pending, void pending", () => {
        it("copies original contactId tags when creating a reverse transaction", async () => {
            const contactIdNotCharged = "no-contact-here";
            const setupResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "setup-checkout",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{
                    rail: "lightrail",
                    valueId: value1.id
                }, {
                    rail: "lightrail",
                    contactId: contactIdNotCharged
                }]
            });
            chai.assert.equal(setupResp.statusCode, 201, `setupResp.body=${JSON.stringify(setupResp.body)}`);
            assertTxHasContactIdTags(setupResp.body, [value1.contactId, contactIdNotCharged]);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${setupResp.body.id}/reverse`, "POST", {
                id: "reverse"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isArray(resp.body.tags, `resp.body should have tags: ${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.tags.length, setupResp.body.tags.length, `resp.body should have same number of tags as original transaction: ${JSON.stringify(resp.body.tags)}`);
            chai.assert.sameDeepMembers(resp.body.tags, setupResp.body.tags, `reverse should have same contactId tags as original transaction: ${JSON.stringify(resp.body.tags)}`);
        });

        it("adds contactId tag when creating a capture transaction", async () => {
            const setupResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "pending-to-capture",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{
                    rail: "lightrail",
                    valueId: value1.id
                }],
                pending: true
            });
            chai.assert.equal(setupResp.statusCode, 201, `setupResp.body=${JSON.stringify(setupResp.body)}`);
            assertTxHasContactIdTags(setupResp.body, [value1.contactId]);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${setupResp.body.id}/capture`, "POST", {
                id: "capture"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isArray(resp.body.tags, `capture transaction should have tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, setupResp.body.tags, `capture transaction should have same tags as original pending transaction`);
        });

        it("adds contactId tag when creating a void transaction", async () => {
            const setupResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "pending-to-void",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{
                    rail: "lightrail",
                    valueId: value1.id
                }],
                pending: true
            });
            chai.assert.equal(setupResp.statusCode, 201, `setupResp.body=${JSON.stringify(setupResp.body)}`);
            assertTxHasContactIdTags(setupResp.body, [value1.contactId]);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${setupResp.body.id}/void`, "POST", {
                id: "void"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isArray(resp.body.tags, `void transaction should have tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, setupResp.body.tags, `void transaction should have same tags as original pending transaction`);
        });

        it("adds contactId tag when value attached after original transaction but before reverse", async () => {
            const newValue = await testUtils.createUSDValue(router);
            chai.assert.isNull(newValue.contactId);
            const firstTx = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
                id: testUtils.generateId(),
                currency: "USD",
                destination: {
                    rail: "lightrail",
                    valueId: newValue.id
                },
                amount: 50
            });
            chai.assert.equal(firstTx.statusCode, 201, `firstTx.body=${JSON.stringify(firstTx.body)}`);
            chai.assert.isUndefined(firstTx.body.tags);

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
                valueId: newValue.id
            });
            chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);
            chai.assert.equal(attachResp.body.contactId, contact1.id);

            const reverseResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${firstTx.body.id}/reverse`, "POST", {
                id: testUtils.generateId()
            });
            chai.assert.equal(reverseResp.statusCode, 201, `reverseResp.body=${JSON.stringify(reverseResp.body)}`);
            assertTxHasContactIdTags(reverseResp.body, [contact1.id]);
        });

        it("adds contactId tag when value attached after original transaction but before capture", async () => {
            const newValue = await testUtils.createUSDValue(router);
            chai.assert.isNull(newValue.contactId);
            const firstTx = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "pending-to-capture-w-attach",
                currency: "USD",
                lineItems: [{unitPrice: 25}],
                sources: [{
                    rail: "lightrail",
                    valueId: newValue.id
                }],
                pending: true
            });
            chai.assert.equal(firstTx.statusCode, 201, `firstTx.body=${JSON.stringify(firstTx.body)}`);
            chai.assert.isUndefined(firstTx.body.tags, `pending transaction should have no tags`);

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
                valueId: newValue.id
            });
            chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);
            chai.assert.equal(attachResp.body.contactId, contact1.id);

            const captureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${firstTx.body.id}/capture`, "POST", {
                id: testUtils.generateId()
            });
            chai.assert.equal(captureResp.statusCode, 201, `captureResp.body=${JSON.stringify(captureResp.body)}`);
            assertTxHasContactIdTags(captureResp.body, [contact1.id]);
        });

        it("adds contactId tag when value attached after original transaction but before void", async () => {
            const newValue = await testUtils.createUSDValue(router);
            chai.assert.isNull(newValue.contactId);
            const firstTx = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "pending-to-void-w-attach",
                currency: "USD",
                lineItems: [{unitPrice: 25}],
                sources: [{
                    rail: "lightrail",
                    valueId: newValue.id
                }],
                pending: true
            });
            chai.assert.equal(firstTx.statusCode, 201, `firstTx.body=${JSON.stringify(firstTx.body)}`);
            chai.assert.isUndefined(firstTx.body.tags, `pending transaction should have no tags`);

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
                valueId: newValue.id
            });
            chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);
            chai.assert.equal(attachResp.body.contactId, contact1.id);

            const voidResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${firstTx.body.id}/void`, "POST", {
                id: testUtils.generateId()
            });
            chai.assert.equal(voidResp.statusCode, 201, `voidResp.body=${JSON.stringify(voidResp.body)}`);
            assertTxHasContactIdTags(voidResp.body, [contact1.id]);
        });

        it("adds contactId tag when value attached after capture transaction but before reverse", async () => {
            const newValue = await testUtils.createUSDValue(router);
            chai.assert.isNull(newValue.contactId);
            const firstTx = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "pending-to-capture-&-reverse",
                currency: "USD",
                lineItems: [{unitPrice: 25}],
                sources: [{
                    rail: "lightrail",
                    valueId: newValue.id
                }],
                pending: true
            });
            chai.assert.equal(firstTx.statusCode, 201, `firstTx.body=${JSON.stringify(firstTx.body)}`);
            chai.assert.isUndefined(firstTx.body.tags, `pending transaction should have no tags`);

            const captureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${firstTx.body.id}/capture`, "POST", {
                id: testUtils.generateId()
            });
            chai.assert.equal(captureResp.statusCode, 201, `captureResp.body=${JSON.stringify(captureResp.body)}`);
            chai.assert.isUndefined(captureResp.body.tags, `capture transaction should have no tags`);

            const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
                valueId: newValue.id
            });
            chai.assert.equal(attachResp.statusCode, 200, `attachResp.body=${JSON.stringify(attachResp.body)}`);
            chai.assert.equal(attachResp.body.contactId, contact1.id);

            const reverseResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${captureResp.body.id}/reverse`, "POST", {id: testUtils.generateId()});
            chai.assert.equal(reverseResp.statusCode, 201, `reverseResp.body=${JSON.stringify(reverseResp.body)}`);
            assertTxHasContactIdTags(reverseResp.body, [contact1.id]);
        });
    });

    it("adds contactId tag when creating a initialBalance transaction", async () => {
        const createValueResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", {
            id: "value-with-initial-balance",
            contactId: contact1.id,
            balance: 100,
            currency: "USD"
        });
        chai.assert.equal(createValueResp.statusCode, 201, `createValueResp.body=${JSON.stringify(createValueResp.body)}`);

        const initialBalanceTxResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${createValueResp.body.id}`, "GET");
        chai.assert.equal(initialBalanceTxResp.statusCode, 200, `initialBalanceTxResp.body=${JSON.stringify(initialBalanceTxResp.body)}`);
        chai.assert.equal(initialBalanceTxResp.body.transactionType, "initialBalance", `initialBalanceTxResp.body=${JSON.stringify(initialBalanceTxResp.body)}`);
        assertTxHasContactIdTags(initialBalanceTxResp.body, [contact1.id]);
    });

    it("does not save new tag data for simulated transactions", async () => {
        const contactId = testUtils.generateId();
        const tag = formatContactIdTags([contactId])[0];

        const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
            id: "checkout-simulated",
            currency: "USD",
            lineItems: [{unitPrice: 100}],
            sources: [{rail: "lightrail", contactId}, {rail: "stripe", source: "tok_visa"}],
            simulate: true
        });
        chai.assert.equal(resp.statusCode, 200, `resp.body=${JSON.stringify(resp.body)}`);

        chai.assert.equal(resp.body.tags.length, 1, `resp.body should have 1 tag: ${JSON.stringify(resp.body)}`);
        chai.assert.sameDeepMembers(resp.body.tags, [tag], `tags=${resp.body.tags}`);
        const fetchSimulatedResp = await testUtils.testAuthedRequest<cassava.RestError>(router, `/v2/transactions/${resp.body.id}`, "GET");
        chai.assert.equal(fetchSimulatedResp.statusCode, cassava.httpStatusCode.clientError.NOT_FOUND, `fetchSimulatedResp.body=${JSON.stringify(fetchSimulatedResp.body)}`);

        const knex = await getKnexRead();
        const tagRes = await knex("Tags")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                id: tag
            });
        chai.assert.equal(tagRes.length, 0, `tag should not exist: ${JSON.stringify(tagRes)}`);

        const transactionsTagsRes = await knex("TransactionsTags")
            .select()
            .where({
                userId: testUtils.defaultTestUser.userId,
                transactionId: resp.body.id
            });
        chai.assert.equal(transactionsTagsRes.length, 0, `TransactionsTags record should not exist: ${JSON.stringify(transactionsTagsRes)}`);
    });

    describe("data isolation", () => {
        before(async () => {
            const usdUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/currencies", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                },
                body: JSON.stringify({
                    code: "USD",
                    decimalPlaces: 2,
                    name: "USD User2",
                    symbol: "$"
                })
            }));
            chai.assert.equal(usdUser2.statusCode, 201, `usdUser2.body=${JSON.stringify(usdUser2.body)}`);
        });

        it("keeps tags & joins separate for separate users", async () => {
            // these properties will be shared by object created for user1 (default test user) and user2 (alt. test user)
            const contactId = testUtils.generateId();
            const valueProps = {id: testUtils.generateId(), currency: "USD", balance: 50};
            const txRequest: CheckoutRequest = {
                id: "tx1",
                currency: "USD",
                lineItems: [{unitPrice: 50}],
                sources: [{rail: "lightrail", contactId}, {rail: "lightrail", valueId: valueProps.id}]
            };

            // create user1 transaction
            await testUtils.createUSDValue(router, valueProps);
            const txUser1 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", txRequest);
            chai.assert.equal(txUser1.statusCode, 201, `txUser1.body=${JSON.stringify(txUser1.body)}`);
            assertTxHasContactIdTags(txUser1.body, [contactId]);

            // create user2 transaction
            const valueUser2Resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`

                },
                body: JSON.stringify(valueProps)
            }));
            chai.assert.equal(valueUser2Resp.statusCode, 201, `valueUser2Resp.body=${JSON.stringify(valueUser2Resp.body)}`);
            const txUser2Resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/checkout", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`

                },
                body: JSON.stringify(txRequest)
            }));
            chai.assert.equal(txUser2Resp.statusCode, 201, `txUser2Resp.body=${JSON.stringify(txUser2Resp.body)}`);
            const txUser2 = JSON.parse(txUser2Resp.body);
            assertTxHasContactIdTags(txUser2, [contactId]);

            // check what was actually written to tags table
            const knex = await getKnexRead();
            const tagRes: Tag[] = await knex("Tags")
                .select()
                .where({
                    id: formatContactIdTags([contactId])[0].id
                });
            chai.assert.equal(tagRes.length, 2, `tag table should have an entry for this tag value for each test user: ${JSON.stringify(tagRes)}`);
            chai.assert.equal(tagRes[0].id, tagRes[1].id, `tags should have the same 'id' value: ${JSON.stringify(tagRes)}`);
            chai.assert.equal(tagRes[0].name, tagRes[1].name, `tags should have the same 'name' value: ${JSON.stringify(tagRes)}`);
            chai.assert.sameMembers(tagRes.map(t => t.userId), [testUtils.defaultTestUser.auth.userId, testUtils.alternateTestUser.auth.userId], `tag table should have an entry for this tag value for each test user: ${JSON.stringify(tagRes)}`);

            // ...and what was actually written to TransactionsTags join table
            const transactionsTagsRes = await knex("TransactionsTags")
                .select()
                .where({
                    transactionId: txRequest.id
                });
            chai.assert.equal(transactionsTagsRes.length, 2, `TransactionsTags table should have an entry for each test user's transaction: ${JSON.stringify(transactionsTagsRes)}`);

            const txTagUser1 = transactionsTagsRes.find(t => t.userId === testUtils.defaultTestUser.auth.userId);
            chai.assert.isObject(txTagUser1, `TransactionsTags should have entry for user1's transaction: ${JSON.stringify(transactionsTagsRes)}`);
            chai.assert.equal(txTagUser1.tagId, tagRes.find(t => t.userId === txTagUser1.userId).id);

            const txTagUser2 = transactionsTagsRes.find(t => t.userId === testUtils.alternateTestUser.auth.userId);
            chai.assert.isObject(txTagUser2, `TransactionsTags should have entry for user2's transaction: ${JSON.stringify(transactionsTagsRes)}`);
            chai.assert.equal(txTagUser2.tagId, tagRes.find(t => t.userId === txTagUser2.userId).id);
        });
    });

    describe("searching by tags", () => {
        let newContact: Contact;
        const fakeContactId = `fake-contact-${testUtils.generateId(5)}`;

        before(async function () {
            this.timeout(8000); // so much setup to do for these tests...

            // create a new contact so we can create a precise number of transactions for it and test that they're all returned when we fetch transactions by tag
            const newContactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: `new-contact-${testUtils.generateId(5)}`});
            chai.assert.equal(newContactResp.statusCode, 201, `newContactResp.body=${JSON.stringify(newContactResp.body)}`);
            newContact = newContactResp.body;

            // setup: create one of each type of transaction for the new contact
            const newValue = await testUtils.createUSDValue(router, {
                id: `newContact-new-value-${testUtils.generateId(6)}`,
                contactId: newContact.id,
                balanceRule: {
                    rule: "500",
                    explanation: "$5"
                },
                balance: null,
                usesRemaining: 25 // arbitrary-ish - only exists so the value can be credited/debited without affecting balance available per transaction
            });
            const initialBalance = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${newValue.id}`, "GET");
            chai.assert.equal(initialBalance.statusCode, 200, `initialBalance.body=${JSON.stringify(initialBalance.body)}`);
            chai.assert.equal(initialBalance.body.transactionType, "initialBalance");
            assertTxHasContactIdTags(initialBalance.body, [newContact.id]);

            const creditResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/credit", "POST", {
                id: `newContact-credit-${testUtils.generateId(6)}`,
                currency: "USD",
                destination: {
                    rail: "lightrail",
                    valueId: newValue.id
                },
                uses: 1
            });
            chai.assert.equal(creditResp.statusCode, 201, `creditResp.body=${JSON.stringify(creditResp.body)}`);
            assertTxHasContactIdTags(creditResp.body, [newContact.id]);

            const debitResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                id: `newContact-debit-${testUtils.generateId(6)}`,
                currency: "USD",
                source: {
                    rail: "lightrail",
                    valueId: newValue.id
                },
                uses: 1
            });
            chai.assert.equal(debitResp.statusCode, 201, `debitResp.body=${JSON.stringify(debitResp.body)}`);
            assertTxHasContactIdTags(debitResp.body, [newContact.id]);

            const valueForTransfer = await testUtils.createUSDValue(router, {
                id: `newContact-value-for-transfer-${testUtils.generateId(6)}`,
                balance: 1, // this is going to be transferred away so that it doesn't affect how much value this contact has available in later transactions
                contactId: newContact.id
            });
            const valueForTransferInitialBalanceTx = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${valueForTransfer.id}`, "GET");
            chai.assert.equal(valueForTransferInitialBalanceTx.statusCode, 200, `valueForTransferInitialBalanceTx.body=${JSON.stringify(valueForTransferInitialBalanceTx.body)}`);
            assertTxHasContactIdTags(valueForTransferInitialBalanceTx.body, [newContact.id]);

            const anotherValueForTransfer = await testUtils.createUSDValue(router, {
                id: `another-value-for-transfer-${testUtils.generateId(6)}`
            });
            const transferResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/transfer", "POST", {
                id: `newContact-transfer-${testUtils.generateId(6)}`,
                currency: "USD",
                source: {
                    rail: "lightrail",
                    valueId: valueForTransfer.id
                },
                destination: {
                    rail: "lightrail",
                    valueId: anotherValueForTransfer.id
                },
                amount: 1
            });
            chai.assert.equal(transferResp.statusCode, 201, `transferResp.body=${JSON.stringify(transferResp.body)}`);
            assertTxHasContactIdTags(transferResp.body, [newContact.id]);

            const genericValue = await testUtils.createUSDValue(router, {
                id: `newContact-generic-value-${testUtils.generateId(6)}`,
                isGenericCode: true,
                genericCodeOptions: {
                    perContact: {
                        balance: 1,
                        usesRemaining: null
                    }
                }
            });
            const checkoutAutoAttachResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: `newContact-checkout-auto-attach-${testUtils.generateId(6)}`,
                currency: "USD",
                lineItems: [{unitPrice: 501}],
                sources: [{rail: "lightrail", contactId: newContact.id}, {rail: "lightrail", valueId: genericValue.id}]
            });
            chai.assert.equal(checkoutAutoAttachResp.statusCode, 201, `checkoutAutoAttachResp.body=${JSON.stringify(checkoutAutoAttachResp.body)}`);
            assertTxHasContactIdTags(checkoutAutoAttachResp.body, [newContact.id]);
            const attachTx = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?transactionType=attach&valueId=${genericValue.id}`, "GET");
            chai.assert.equal(attachTx.statusCode, 200, `attachTx.body=${JSON.stringify(attachTx.body)}`);
            chai.assert.equal(attachTx.body.length, 1, `should have exactly one transaction - attachTx.body=${JSON.stringify(attachTx.body)}`);
            assertTxHasContactIdTags(attachTx.body[0], [newContact.id]);

            const reverseResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${checkoutAutoAttachResp.body.id}/reverse`, "POST", {
                id: `newContact-reverse-${testUtils.generateId(6)}`
            });
            chai.assert.equal(reverseResp.statusCode, 201, `reverseResp.body=${JSON.stringify(reverseResp.body)}`);
            assertTxHasContactIdTags(reverseResp.body, [newContact.id]);

            const pendingResp1 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: `newContact-pending1-${testUtils.generateId(6)}`,
                pending: true,
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: newContact.id}]
            });
            chai.assert.equal(pendingResp1.statusCode, 201, `pendingResp1.body=${JSON.stringify(pendingResp1.body)}`);
            assertTxHasContactIdTags(pendingResp1.body, [newContact.id]);

            const captureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingResp1.body.id}/capture`, "POST", {
                id: `newContact-capture-${testUtils.generateId(6)}`
            });
            chai.assert.equal(captureResp.statusCode, 201, `captureResp.body=${JSON.stringify(captureResp.body)}`);
            assertTxHasContactIdTags(captureResp.body, [newContact.id]);

            const pendingResp2 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: `newContact-pending2-${testUtils.generateId(6)}`,
                pending: true,
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: newContact.id}]
            });
            chai.assert.equal(pendingResp2.statusCode, 201, `pendingResp2.body=${JSON.stringify(pendingResp2.body)}`);
            assertTxHasContactIdTags(pendingResp2.body, [newContact.id]);

            const voidResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${pendingResp2.body.id}/void`, "POST", {
                id: `newContact-void-${testUtils.generateId(6)}`
            });
            chai.assert.equal(voidResp.statusCode, 201, `voidResp.body=${JSON.stringify(voidResp.body)}`);
            assertTxHasContactIdTags(voidResp.body, [newContact.id]);

            // more setup: transactions that will have a contactId in the payment sources but not the steps, because the contact doesn't actually exist
            // ...tx amount will instead be covered by this unattached value
            const unattachedValue = await testUtils.createUSDValue(router, {
                id: `discount-covers-entire-transaction-amount`,
                discount: true,
                balanceRule: {
                    rule: "totals.subtotal",
                    explanation: "100% of transaction"
                },
                balance: null
            });

            // this checkout will have two fake contactIds so it can be used in the multi-contact tx lookup test
            const fakeContactCheckoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: `checkout-${testUtils.generateId(6)}`,
                currency: "USD",
                lineItems: [{unitPrice: 501}],
                sources: [{rail: "lightrail", contactId: fakeContactId}, {
                    rail: "lightrail",
                    valueId: unattachedValue.id
                }]
            });
            chai.assert.equal(fakeContactCheckoutResp.statusCode, 201, `fakeContactCheckoutResp.body=${JSON.stringify(fakeContactCheckoutResp.body)}`);
            chai.assert.isUndefined(fakeContactCheckoutResp.body.steps.find(s => (s as LightrailTransactionStep).contactId === fakeContactId), `contactId should not appear in any steps: steps=${JSON.stringify(fakeContactCheckoutResp.body.steps)}`);
            assertTxHasContactIdTags(fakeContactCheckoutResp.body, [fakeContactId]);

            const fakeContactReverseResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${fakeContactCheckoutResp.body.id}/reverse`, "POST", {
                id: `reverse-${testUtils.generateId(6)}`
            });
            chai.assert.equal(fakeContactReverseResp.statusCode, 201, `fakeContactReverseResp.body=${JSON.stringify(fakeContactReverseResp.body)}`);
            chai.assert.isUndefined(fakeContactReverseResp.body.steps.find(s => (s as LightrailTransactionStep).contactId === fakeContactId), `contactId should not appear in any steps: steps=${JSON.stringify(fakeContactReverseResp.body.steps)}`);
            assertTxHasContactIdTags(fakeContactReverseResp.body, [fakeContactId]);

            const fakeContactPendingResp1 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: `pending1-${testUtils.generateId(6)}`,
                pending: true,
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: fakeContactId}, {
                    rail: "lightrail",
                    valueId: unattachedValue.id
                }]
            });
            chai.assert.equal(fakeContactPendingResp1.statusCode, 201, `fakeContactPendingResp1.body=${JSON.stringify(fakeContactPendingResp1.body)}`);
            chai.assert.isUndefined(fakeContactPendingResp1.body.steps.find(s => (s as LightrailTransactionStep).contactId === fakeContactId), `contactId should not appear in any steps: steps=${JSON.stringify(fakeContactPendingResp1.body.steps)}`);
            assertTxHasContactIdTags(fakeContactPendingResp1.body, [fakeContactId]);

            const fakeContactCaptureResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${fakeContactPendingResp1.body.id}/capture`, "POST", {
                id: `capture-${testUtils.generateId(6)}`
            });
            chai.assert.equal(fakeContactCaptureResp.statusCode, 201, `fakeContactCaptureResp.body=${JSON.stringify(fakeContactCaptureResp.body)}`);
            assertTxHasContactIdTags(fakeContactCaptureResp.body, [fakeContactId]);

            const fakeContactPendingResp2 = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: `pending2-${testUtils.generateId(6)}`,
                pending: true,
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: fakeContactId}, {
                    rail: "lightrail",
                    valueId: unattachedValue.id
                }]
            });
            chai.assert.equal(fakeContactPendingResp2.statusCode, 201, `fakeContactPendingResp2.body=${JSON.stringify(fakeContactPendingResp2.body)}`);
            chai.assert.isUndefined(fakeContactPendingResp2.body.steps.find(s => (s as LightrailTransactionStep).contactId === fakeContactId), `contactId should not appear in any steps: steps=${JSON.stringify(fakeContactPendingResp2.body.steps)}`);
            assertTxHasContactIdTags(fakeContactPendingResp2.body, [fakeContactId]);

            const fakeContactVoidResp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${fakeContactPendingResp2.body.id}/void`, "POST", {
                id: `void-${testUtils.generateId(6)}`
            });
            chai.assert.equal(fakeContactVoidResp.statusCode, 201, `fakeContactVoidResp.body=${JSON.stringify(fakeContactVoidResp.body)}`);
            chai.assert.isUndefined(fakeContactVoidResp.body.steps.find(s => (s as LightrailTransactionStep).contactId === fakeContactId), `contactId should not appear in any steps: steps=${JSON.stringify(fakeContactVoidResp.body.steps)}`);
            assertTxHasContactIdTags(fakeContactVoidResp.body, [fakeContactId]);
        });

        it("fetches the transactions for a contact that actually gets charged: contactId on step", async () => {
            const knex = await getKnexRead();
            const txTagsRes = await knex.select("TransactionsTags.*").from("TransactionsTags").join("Tags", {
                "TransactionsTags.userId": "Tags.userId",
                "TransactionsTags.tagId": "Tags.id"
            }).where({
                "Tags.userId": testUtils.defaultTestUser.auth.userId,
                "Tags.id": formatContactIdTags([newContact.id])[0].id
            });
            chai.assert.equal(txTagsRes.length, 12, `there should be exactly 12 transactions with the newContact.id tag: ${JSON.stringify(txTagsRes, null, 4)}`);

            const transactionsResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?tagId=${formatContactIdTags([newContact.id])[0].id}`, "GET");
            chai.assert.equal(transactionsResp.statusCode, 200, `transactionsResp.body=${JSON.stringify(transactionsResp)}`);
            chai.assert.equal(transactionsResp.body.length, txTagsRes.length, `should have same number of transactions for newContact.id as there are TxTags records for newContact.id tag: tx IDs=${transactionsResp.body.map(t => t.id)}`);
        });

        it("fetches the transactions for a contact that does not get charged: contactId in payment sources, not steps", async () => {
            const knex = await getKnexRead();
            const txTagsRes = await knex.select("TransactionsTags.*").from("TransactionsTags").join("Tags", {
                "TransactionsTags.userId": "Tags.userId",
                "TransactionsTags.tagId": "Tags.id"
            }).where({
                "Tags.userId": testUtils.defaultTestUser.auth.userId,
                "Tags.id": formatContactIdTags([fakeContactId])[0].id
            });
            chai.assert.equal(txTagsRes.length, 6, `there should be exactly 6 transactions with the fakeContactId tag: ${JSON.stringify(txTagsRes, null, 4)}`);

            const transactionsResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?tagId=${formatContactIdTags([fakeContactId])[0].id}`, "GET");
            chai.assert.equal(transactionsResp.statusCode, 200, `transactionsResp.body=${JSON.stringify(transactionsResp)}`);
            chai.assert.equal(transactionsResp.body.length, txTagsRes.length, `should have same number of transactions for fakeContactId as there are TxTags records for fakeContactId tag: tx IDs=${JSON.stringify(transactionsResp.body.map(t => ({
                id: t.id,
                tags: t.tags
            })), null, 4)}`);
        }).timeout(8000);

        it("fetches 0 transactions if the tag does not exist", async () => {
            const transactionsResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?tagId=${testUtils.generateId()}`, "GET");
            chai.assert.equal(transactionsResp.statusCode, 200, `transactionsResp.body=${JSON.stringify(transactionsResp.body)}`);
            chai.assert.equal(transactionsResp.body.length, 0, `no transactions should be returned when searching by a tag value that doesn't exist: transactions=${JSON.stringify(transactionsResp.body)}`);
        });
    });

    describe("error handling", () => {
        const sinonSandbox = sinon.createSandbox();

        before(() => {
            sinonSandbox.stub(InsertTransactions, "applyTransactionTags")
                .rejects(new Error("Error for testing - tag insertion failure"));
        });

        after(() => {
            sinonSandbox.restore();
            unsetStubsForStripeTests();
        });

        it("rolls back the transaction if tag insertion fails", async () => {
            const checkoutFailureResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                id: "this-checkout-will-fail",
                currency: "USD",
                lineItems: [{unitPrice: 50}],
                sources: [{rail: "lightrail", contactId: contact1.id}]
            });
            chai.assert.equal(checkoutFailureResp.statusCode, 409, `checkoutFailureResp.body=${JSON.stringify(checkoutFailureResp)}`);
            chai.assert.match(checkoutFailureResp.body.message, /An error occurred processing tags for transaction/, `checkoutFailureResp.body=${JSON.stringify(checkoutFailureResp.body)}`);

            const transactionNotFoundResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/this-checkout-will-fail", "GET");
            chai.assert.equal(transactionNotFoundResp.statusCode, 404);
        });

        it("rolls back the Stripe step if tag insertion fails", async () => {
            await setStubsForStripeTests();

            const logSpy = sinonSandbox.spy(log, "warn");

            const checkoutFailureResp = await testUtils.testAuthedRequest<cassava.RestError>(router, "/v2/transactions/checkout", "POST", {
                id: testUtils.generateId(),
                currency: "USD",
                lineItems: [{unitPrice: 500}],
                sources: [{
                    rail: "lightrail",
                    contactId: testUtils.generateId()
                }, {
                    rail: "stripe",
                    source: "tok_visa"
                }]
            });
            chai.assert.equal(checkoutFailureResp.statusCode, 409, `checkoutFailureResp.body=${JSON.stringify(checkoutFailureResp)}`);

            chai.assert.isDefined(logSpy.args.find(argsPerCall => argsPerCall.find(arg => arg.match(/An error occurred while processing transaction '.+'. The Stripe charge\(s\) '.+' have been refunded./))));
        });
    });

    describe("utils", () => {
        it("formats contactId tags for new transaction", () => {
            const tags = formatContactIdTags(["contact1", "contact2"]);
            chai.assert.deepEqual(tags[0], {id: "lr:contactId:contact1"});
            chai.assert.deepEqual(tags[1], {id: "lr:contactId:contact2"});
        });

        it("maintains format of contactId tags from earlier transactions", () => {
            const tags = formatContactIdTags([], [{id: "lr:contactId:contact1"}, {id: "lr:contactId:contact2"}]);
            chai.assert.deepEqual(tags[0], {id: "lr:contactId:contact1"});
            chai.assert.deepEqual(tags[1], {id: "lr:contactId:contact2"});
        });

        it("does not duplicate existing tags", () => {
            const oldTags = [{id: "lr:contactId:contact1"}, {id: testUtils.generateId()}];
            const tags = formatContactIdTags(["contact1", "contact2"], oldTags);
            chai.assert.equal(tags.length, 3);
            chai.assert.sameDeepMembers(tags, [...oldTags, ...formatContactIdTags(["contact2"])]);
        });
    });
});

function assertTxHasContactIdTags(tx: Transaction, contactIds: string[]): void {
    chai.assert.isArray(tx.tags, `expected transaction to have tags: ${JSON.stringify(tx)}`);
    const contactIdTags = formatContactIdTags(contactIds);

    chai.assert.sameDeepMembers(tx.tags, contactIdTags, `expected transaction '${tx.id}' (type='${tx.transactionType}') to have all contactId tags: expected tags='${JSON.stringify(contactIdTags)}' tx.tags='${JSON.stringify(tx.tags)}'`);
}

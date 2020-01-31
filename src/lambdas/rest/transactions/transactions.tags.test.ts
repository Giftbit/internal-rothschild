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
        it("unique attached value as source", async () => {
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-uq-attached-value",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", valueId: value1.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            chai.assert.equal(resp.body.tags.length, 1, `resp.body should have 1 tag: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`], `tags=${resp.body.tags}`);
        });

        it("contactId as source", async () => {
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-cid",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: contact1.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            chai.assert.equal(resp.body.tags.length, 1, `resp.body should have 1 tag: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`], `tags=${resp.body.tags}`);
        });

        it("2nd contactId as source, doesn't get used", async () => {
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

            chai.assert.equal(resp.body.tags.length, 2, `resp.body should have 2 tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`, `contactId:${contact2.id}`], `tags=${resp.body.tags}`);
        });

        it("2nd unique value (attached to different contact) as source, doesn't get used", async () => {
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

            chai.assert.equal(resp.body.tags.length, 2, `resp.body should have 2 tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`, `contactId:${newContact.id}`], `tags=${resp.body.tags}`);
        });

        it("contactId that doesn't exist as source", async () => {
            const resp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: "checkout-nonexistent-cid",
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources: [{rail: "lightrail", contactId: "gibberish"}, {rail: "lightrail", valueId: value1.id}]
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);

            chai.assert.equal(resp.body.tags.length, 2, `resp.body should have 2 tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`, `contactId:gibberish`], `tags=${resp.body.tags}`);
        });

        it("does not tag checkouts that involve no contacts", async () => {
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

        it("can create a checkout with a shared generic code", async () => {
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
            chai.assert.equal(checkoutResp.body.tags.length, 1, `checkoutResp.body should have 1 tag: ${JSON.stringify(checkoutResp.body)}`);
            chai.assert.sameDeepMembers(checkoutResp.body.tags, [`contactId:${newContact.id}`], `tags=${checkoutResp.body.tags}`);
        });

        describe("auto attach", () => {
            it("can create a checkout with auto-attaches", async () => {
                const newContact: Partial<Contact> = {id: `new-contact-${testUtils.generateId(4)}`};
                const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", newContact);
                chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp)}`);

                const perContactValue1: Partial<Value> = {
                    id: "gen-val-per-contact-1",
                    currency: "USD",
                    isGenericCode: true,
                    genericCodeOptions: {
                        perContact: {
                            balance: 50,
                            usesRemaining: null
                        }
                    }
                };
                const v1SetupResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", perContactValue1);
                chai.assert.equal(v1SetupResp.statusCode, 201, `v1SetupResp.body=${JSON.stringify(v1SetupResp.body)}`);
                const perContactValue2: Partial<Value> = {
                    id: "gen-val-per-contact-2",
                    currency: "USD",
                    isGenericCode: true,
                    genericCodeOptions: {
                        perContact: {
                            balance: 50,
                            usesRemaining: null
                        }
                    }
                };
                const v2SetupResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", perContactValue2);
                chai.assert.equal(v2SetupResp.statusCode, 201, `v2SetupResp.body=${JSON.stringify(v2SetupResp.body)}`);

                const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                    id: "checkout-w-auto-attach",
                    currency: "USD",
                    lineItems: [{unitPrice: 100}],
                    sources: [{
                        rail: "lightrail",
                        valueId: perContactValue1.id
                    }, {
                        rail: "lightrail",
                        valueId: perContactValue2.id
                    }, {
                        rail: "lightrail",
                        contactId: newContact.id
                    }]
                });
                chai.assert.equal(checkoutResp.statusCode, 201, `checkoutResp.body=${JSON.stringify(checkoutResp.body)}`);
                chai.assert.equal(checkoutResp.body.tags.length, 1, `checkoutResp.body should have 1 tag: ${JSON.stringify(checkoutResp.body)}`);
                chai.assert.sameDeepMembers(checkoutResp.body.tags, [`contactId:${newContact.id}`], `tags=${checkoutResp.body.tags}`);
            });
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
        chai.assert.equal(resp.body.tags.length, 1, `resp.body should have 1 tag: ${JSON.stringify(resp.body)}`);
        chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`], `tags=${resp.body.tags}`);
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
        chai.assert.equal(resp.body.tags.length, 1, `resp.body should have 1 tag: ${JSON.stringify(resp.body)}`);
        chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`], `tags=${resp.body.tags}`);
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
        chai.assert.equal(resp.body.tags.length, 1, `resp.body should have 1 tag: ${JSON.stringify(resp.body)}`);
        chai.assert.sameDeepMembers(resp.body.tags, [`contactId:${contact1.id}`], `tags=${resp.body.tags}`);
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
            chai.assert.isArray(setupResp.body.tags, `setupResp.body should have tags: ${JSON.stringify(setupResp.body)}`);
            chai.assert.equal(setupResp.body.tags.length, 2, `setupResp.body should have 2 tags: ${JSON.stringify(setupResp.body)}`);
            chai.assert.sameDeepMembers(setupResp.body.tags, [`contactId:${value1.contactId}`, `contactId:${contactIdNotCharged}`], `tags=${setupResp.body.tags}`);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${setupResp.body.id}/reverse`, "POST", {
                id: "reverse"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isArray(resp.body.tags, `resp.body should have tags: ${JSON.stringify(resp.body)}`);
            chai.assert.equal(resp.body.tags.length, setupResp.body.tags.length, `resp.body should have same number of tags as original transaction: ${JSON.stringify(resp.body.tags)}`);
            chai.assert.sameDeepMembers(resp.body.tags, setupResp.body.tags, `reverse should have same contactId tags as original transaction: ${JSON.stringify(resp.body.tags)}`);
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
            chai.assert.isArray(reverseResp.body.tags, "reverse should have tags");
            chai.assert.equal(reverseResp.body.tags.length, 1);
            chai.assert.equal(reverseResp.body.tags[0], `contactId:${contact1.id}`);
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
            chai.assert.isArray(setupResp.body.tags, `pending transaction should have tags: ${JSON.stringify(setupResp.body)}`);
            chai.assert.sameDeepMembers(setupResp.body.tags, [`contactId:${value1.contactId}`]);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${setupResp.body.id}/capture`, "POST", {
                id: "capture"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isArray(resp.body.tags, `capture transaction should have tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, setupResp.body.tags, `capture transaction should have same tags as original pending transaction`);
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
            chai.assert.isArray(captureResp.body.tags, "capture transaction should have tags");
            chai.assert.equal(captureResp.body.tags.length, 1);
            chai.assert.equal(captureResp.body.tags[0], `contactId:${contact1.id}`);
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
            chai.assert.isArray(setupResp.body.tags, `pending transaction should have tags: ${JSON.stringify(setupResp.body)}`);
            chai.assert.sameDeepMembers(setupResp.body.tags, [`contactId:${value1.contactId}`]);

            const resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/transactions/${setupResp.body.id}/void`, "POST", {
                id: "void"
            });
            chai.assert.equal(resp.statusCode, 201, `resp.body=${JSON.stringify(resp.body)}`);
            chai.assert.isArray(resp.body.tags, `void transaction should have tags: ${JSON.stringify(resp.body)}`);
            chai.assert.sameDeepMembers(resp.body.tags, setupResp.body.tags, `void transaction should have same tags as original pending transaction`);
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
            chai.assert.isArray(voidResp.body.tags, "void transaction should have tags");
            chai.assert.equal(voidResp.body.tags.length, 1);
            chai.assert.equal(voidResp.body.tags[0], `contactId:${contact1.id}`);
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
        chai.assert.sameDeepMembers(initialBalanceTxResp.body.tags, [`contactId:${contact1.id}`], `tags=${initialBalanceTxResp.body.tags}`);
    });

    it("adds contactId tag when attaching a generic value with perContact options", async () => {
        const valueToAttach: Partial<Value> = {
            id: "generic-value-per-contact-options",
            currency: "USD",
            isGenericCode: true,
            genericCodeOptions: {
                perContact: {
                    balance: 1000,
                    usesRemaining: null
                }
            }
        };
        const valueSetupResp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", valueToAttach);
        chai.assert.equal(valueSetupResp.statusCode, 201, `valueSetupResp.body=${JSON.stringify(valueSetupResp.body)}`);

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact1.id}/values/attach`, "POST", {
            valueId: valueToAttach.id
        });
        chai.assert.equal(attachResp.statusCode, 200, `.body=${JSON.stringify(attachResp)}`);

        const txResp = await testUtils.testAuthedRequest<Transaction[]>(router, `/v2/transactions?transactionType=attach&valueId=${valueToAttach.id}`, "GET");
        chai.assert.equal(txResp.statusCode, 200, `txResp.body=${JSON.stringify(txResp.body)}`);
        chai.assert.equal(txResp.body.length, 1, `txResp.body should only have one transaction=${JSON.stringify(txResp.body)}`);
        chai.assert.equal(txResp.body[0].transactionType, "attach", `transactionType should be 'attach': ${txResp.body[0].transactionType}`);
        chai.assert.equal(txResp.body[0].tags.length, 1, `txResp.body[0] should have 1 tag: ${JSON.stringify(txResp.body[0])}`);
        chai.assert.sameDeepMembers(txResp.body[0].tags, [`contactId:${contact1.id}`], `tags=${txResp.body[0].tags}`);
    });

    it("does not save new tag data for simulated transactions", async () => {
        const contactId = testUtils.generateId();
        const tag = `contactId:${contactId}`;

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
                tag
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
            chai.assert.isArray(txUser1.body.tags, `txUser1 should have tags: ${JSON.stringify(txUser1.body)}`);
            chai.assert.equal(txUser1.body.tags.length, 1);
            chai.assert.equal(txUser1.body.tags[0], `contactId:${contactId}`);

            // create user2 transaction
            const valueUser2Resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`,

                },
                body: JSON.stringify(valueProps)
            }));
            chai.assert.equal(valueUser2Resp.statusCode, 201, `valueUser2Resp.body=${JSON.stringify(valueUser2Resp.body)}`);
            const txUser2Resp = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/transactions/checkout", "POST", {
                headers: {
                    Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`,

                },
                body: JSON.stringify(txRequest)
            }));
            chai.assert.equal(txUser2Resp.statusCode, 201, `txUser2Resp.body=${JSON.stringify(txUser2Resp.body)}`);
            const txUser2 = JSON.parse(txUser2Resp.body);
            chai.assert.isArray(txUser2.tags, `txUser2 should have tags: ${JSON.stringify(txUser2.body)}`);
            chai.assert.equal(txUser2.tags.length, 1);
            chai.assert.equal(txUser2.tags[0], `contactId:${contactId}`);

            // check what was actually written to tags table
            const knex = await getKnexRead();
            const tagRes: Tag[] = await knex("Tags")
                .select()
                .where({
                    tag: `contactId:${contactId}`
                });
            chai.assert.equal(tagRes.length, 2, `tag table should have an entry for this tag value for each test user: ${JSON.stringify(tagRes)}`);
            chai.assert.equal(tagRes[0].tag, tagRes[1].tag, `tags should have the same 'tag' value: ${JSON.stringify(tagRes)}`);
            chai.assert.sameMembers(tagRes.map(t => t.userId), [testUtils.defaultTestUser.auth.userId, testUtils.alternateTestUser.auth.userId], `tag table should have an entry for this tag value for each test user: ${JSON.stringify(tagRes)}`);

            // ...and what was actually written to TransactionsTags join table
            const transactionsTagsRes = await knex("TransactionsTags")
                .select()
                .where({
                    transactionId: txRequest.id,
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
});

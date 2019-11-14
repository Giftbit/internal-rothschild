import * as testUtils from "../../../../utils/testUtils";
import {generateId} from "../../../../utils/testUtils";
import {Contact} from "../../../../model/Contact";
import * as chai from "chai";
import {Value} from "../../../../model/Value";
import {LightrailTransactionParty} from "../../../../model/TransactionRequest";
import {LightrailTransactionStep, Transaction} from "../../../../model/Transaction";
import * as cassava from "cassava";
import {installRestRoutes} from "../../installRestRoutes";

describe("checkout - handling limited balance/uses on generic values", () => {
    const router = new cassava.Router();

    before(async () => {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        await testUtils.createUSD(router);
    });

    describe("shared generic values with insufficient usesRemaining / balance", () => {
        it("409s if insufficient usesRemaining and transaction can't be covered by other sources", async () => {
            const contactId1 = `contact1_${generateId(5)}`;
            const contactId2 = `contact2_${generateId(5)}`;
            const contact1Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId1});
            chai.assert.equal(contact1Resp.statusCode, 201);
            const contact2Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId2});
            chai.assert.equal(contact2Resp.statusCode, 201);

            const sharedGenericLimitedUses = await testUtils.createUSDValue(router, {
                id: `sharedLimitedUses_${generateId(5)}`,
                isGenericCode: true,
                balanceRule: {rule: "50", explanation: ""},
                balance: null,
                usesRemaining: 1
            });
            const attachContact1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId1}/values/attach`, "POST", {valueId: sharedGenericLimitedUses.id});
            chai.assert.equal(attachContact1Resp.statusCode, 200);
            const attachContact2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId2}/values/attach`, "POST", {valueId: sharedGenericLimitedUses.id});
            chai.assert.equal(attachContact2Resp.statusCode, 200);

            const getContact1ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId1}/values`, "GET");
            chai.assert.equal(getContact1ValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContact1ValuesResp.body)}`);
            chai.assert.equal(getContact1ValuesResp.body.length, 1, `getContactsValuesResp.body=${JSON.stringify(getContact1ValuesResp.body)}`);
            const getContact2ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId2}/values`, "GET");
            chai.assert.equal(getContact2ValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContact2ValuesResp.body)}`);
            chai.assert.equal(getContact2ValuesResp.body.length, 1, `getContactsValuesResp.body=${JSON.stringify(getContact2ValuesResp.body)}`);

            const sources: LightrailTransactionParty[] = [{
                rail: "lightrail",
                contactId: contactId1
            }, {
                rail: "lightrail",
                contactId: contactId2
            }];
            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: generateId(),
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources
            });
            chai.assert.equal(checkoutResp.statusCode, 409, `checkoutResp.body=${JSON.stringify(checkoutResp.body, null, 4)}`);
        });

        it("409s if insufficient balance and transaction can't be covered by other sources", async () => {
            const contactId1 = `contact1_${generateId(5)}`;
            const contactId2 = `contact2_${generateId(5)}`;
            const contact1Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId1});
            chai.assert.equal(contact1Resp.statusCode, 201);
            const contact2Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId2});
            chai.assert.equal(contact2Resp.statusCode, 201);

            const sharedGenericBalance = await testUtils.createUSDValue(router, {
                id: `sharedLimitedUses_${generateId(5)}`,
                isGenericCode: true,
                balance: 50
            });
            const attachContact1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId1}/values/attach`, "POST", {valueId: sharedGenericBalance.id});
            chai.assert.equal(attachContact1Resp.statusCode, 200);
            const attachContact2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId2}/values/attach`, "POST", {valueId: sharedGenericBalance.id});
            chai.assert.equal(attachContact2Resp.statusCode, 200);

            const getContact1ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId1}/values`, "GET");
            chai.assert.equal(getContact1ValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContact1ValuesResp.body)}`);
            chai.assert.equal(getContact1ValuesResp.body.length, 1, `getContactsValuesResp.body=${JSON.stringify(getContact1ValuesResp.body)}`);
            const getContact2ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId2}/values`, "GET");
            chai.assert.equal(getContact2ValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContact2ValuesResp.body)}`);
            chai.assert.equal(getContact2ValuesResp.body.length, 1, `getContactsValuesResp.body=${JSON.stringify(getContact2ValuesResp.body)}`);

            const sources: LightrailTransactionParty[] = [{
                rail: "lightrail",
                contactId: contactId1
            }, {
                rail: "lightrail",
                contactId: contactId2
            }];
            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: generateId(),
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources
            });
            chai.assert.equal(checkoutResp.statusCode, 409, `checkoutResp.body=${JSON.stringify(checkoutResp.body, null, 4)}`);
        });

        /**
         * This test is an acknowledgement of known behaviour in an unlikely situation, not a prescription.
         *  If a shared generic value has insufficient usesRemaining or balance to be used by both [all] attached
         *  contacts in a transaction, it will generally fail. There is an edge-of-the-edge case where the transaction
         *  will succeed instead: if nothing forces the steps into a particular order (ie discounts being applied first),
         *  the generic value MAY be successfully charged for one contact and not another.
         */
        it("409s if value with one use remaining is attached to two contacts as sources", async () => {
            const contactId1 = `contact1_${generateId(5)}`;
            const contactId2 = `contact2_${generateId(5)}`;
            const contact1Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId1});
            chai.assert.equal(contact1Resp.statusCode, 201);
            const contact2Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId2});
            chai.assert.equal(contact2Resp.statusCode, 201);

            const sharedGenericLimitedUses = await testUtils.createUSDValue(router, {
                id: `sharedLimitedUses_${generateId(5)}`,
                discount: true, // make sure this value will be applied first
                isGenericCode: true,
                balanceRule: {rule: "50", explanation: ""},
                balance: null,
                usesRemaining: 1
            });
            const attachContact1Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId1}/values/attach`, "POST", {valueId: sharedGenericLimitedUses.id});
            chai.assert.equal(attachContact1Resp.statusCode, 200);
            const attachContact2Resp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId2}/values/attach`, "POST", {valueId: sharedGenericLimitedUses.id});
            chai.assert.equal(attachContact2Resp.statusCode, 200);

            await testUtils.createUSDValue(router, {
                contactId: contactId1,
                balanceRule: {
                    rule: "75",
                    explanation: "enough to cover the rest of the transaction amount if the shared generic only gets used once"
                },
                balance: null
            });

            const getContact1ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId1}/values`, "GET");
            chai.assert.equal(getContact1ValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContact1ValuesResp.body)}`);
            chai.assert.equal(getContact1ValuesResp.body.length, 2, `getContactsValuesResp.body=${JSON.stringify(getContact1ValuesResp.body)}`);
            const getContact2ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId2}/values`, "GET");
            chai.assert.equal(getContact2ValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContact2ValuesResp.body)}`);
            chai.assert.equal(getContact2ValuesResp.body.length, 1, `getContactsValuesResp.body=${JSON.stringify(getContact2ValuesResp.body)}`);

            const sources: LightrailTransactionParty[] = [{
                rail: "lightrail",
                contactId: contactId1
            }, {
                rail: "lightrail",
                contactId: contactId2
            }];
            const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
                id: generateId(),
                currency: "USD",
                lineItems: [{unitPrice: 100}],
                sources
            });
            chai.assert.equal(checkoutResp.statusCode, 409, `checkoutResp.body=${JSON.stringify(checkoutResp.body, null, 4)}`);
        });
    });

    it("allows multiple shared generic values with limited balance", async () => {
        const shared1 = await testUtils.createUSDValue(router, {isGenericCode: true, balance: 27});
        chai.assert.equal(shared1.balance, 27);
        const shared2 = await testUtils.createUSDValue(router, {isGenericCode: true, balance: 73});
        chai.assert.equal(shared2.balance, 73);

        const contactId = generateId(8);
        const contactResp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", {id: contactId});
        chai.assert.equal(contactResp.statusCode, 201, `contactResp.body=${JSON.stringify(contactResp.body)}`);

        const attach1Resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {valueId: shared1.id});
        chai.assert.equal(attach1Resp.statusCode, 200, `attach1Resp.body=${JSON.stringify(attach1Resp.body)}`);
        const attach2Resp = await testUtils.testAuthedRequest<Transaction>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {valueId: shared2.id});
        chai.assert.equal(attach2Resp.statusCode, 200, `attach2Resp.body=${JSON.stringify(attach2Resp.body)}`);

        const getContactsValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/contacts/${contactId}/values`, "GET");
        chai.assert.equal(getContactsValuesResp.statusCode, 200, `getContactsValuesResp.body=${JSON.stringify(getContactsValuesResp.body)}`);
        chai.assert.equal(getContactsValuesResp.body.length, 2, `getContactsValuesResp.body=${JSON.stringify(getContactsValuesResp.body)}`);

        const checkoutResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/checkout", "POST", {
            id: generateId(),
            currency: "USD",
            lineItems: [{unitPrice: 100}],
            sources: [{
                rail: "lightrail",
                contactId: contactId
            }]
        });
        chai.assert.equal(checkoutResp.statusCode, 201, `checkoutResp.body=${JSON.stringify(checkoutResp.body)}`);
        chai.assert.sameDeepMembers(checkoutResp.body.steps.map(s => (s as LightrailTransactionStep).valueId), [shared1.id, shared2.id]);
    });
});

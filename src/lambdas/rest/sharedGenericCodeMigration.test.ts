import * as cassava from "cassava";
import * as chai from "chai";
import {installRestRoutes} from "./installRestRoutes";
import * as testUtils from "../../utils/testUtils";
import {generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../utils/testUtils";
import {Currency} from "../../model/Currency";
import {createCurrency} from "./currencies";
import chaiExclude from "chai-exclude";
import {getSqlErrorConstraintName, nowInDbPrecision} from "../../utils/dbUtils";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Value} from "../../model/Value";
import {DbContactValue} from "../../model/DbContactValue";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {Contact} from "../../model/Contact";
import {Transaction} from "../../model/Transaction";

chai.use(chaiExclude);

describe("/v2/sharedGenericCodeMigration", () => {

    const router = new cassava.Router();

    const currency: Currency = {
        code: "USD",
        decimalPlaces: 2,
        symbol: "$",
        name: "US Dollars",
        createdDate: nowInDbPrecision(),
        updatedDate: nowInDbPrecision(),
        createdBy: testUtils.defaultTestUser.teamMemberId
    };

    const contact1: Partial<Contact> = {
        id: generateId()
    };

    const contact2: Partial<Contact> = {
        id: generateId()
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, currency);

        const createContact1 = await testAuthedRequest(router, "/v2/contacts", "POST", contact1);
        chai.assert.equal(createContact1.statusCode, 201);

        const createContact2 = await testAuthedRequest(router, "/v2/contacts", "POST", contact2);
        chai.assert.equal(createContact2.statusCode, 201);
    });

    const genericCodeBaseProps: Partial<Value> = {
        currency: "USD",
        isGenericCode: true
    };

    const testData: { genericCode: Partial<Value>, attachedContacts: Partial<Contact>[] }[] = [
        {
            genericCode: {
                ...genericCodeBaseProps,
                id: generateId() + "0",
                balance: 500
            },
            attachedContacts: [contact1]
        },
        {
            genericCode: {
                ...genericCodeBaseProps,
                id: generateId() + "1",
                balance: 0
            },
            attachedContacts: [contact1]
        },
        {
            genericCode: {
                ...genericCodeBaseProps,
                id: generateId() + "2",
                balanceRule: {rule: "2", explanation: "2 cents off all items"},
                usesRemaining: 50
            },
            attachedContacts: [contact1, contact2]
        },
        {
            genericCode: {
                ...genericCodeBaseProps,
                id: generateId() + "3",
                balanceRule: {rule: "3", explanation: "3 cents off all items"}
            },
            attachedContacts: [contact1, contact2]
        }
    ];

    it("shared generic code migration", async () => {
        for (const data of testData) {
            const createGenericCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", data.genericCode);
            chai.assert.equal(createGenericCode.statusCode, 201);

            for (const contact of data.attachedContacts) {
                await attachSharedGenericValue(testUtils.defaultTestUser.auth, contact.id, createGenericCode.body);
            }
        }

        const migrate = await testAuthedRequest(router, "/v2/sharedGenericCodeMigration", "POST", {userId: testUtils.defaultTestUser.userId});
        chai.assert.deepEqual(migrate.body, {
            migrated: {
                contactValues: 6,
                sharedGenericCodes: 4
            }
        });

        // contact 1 assertions
        const contact1Values = await testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contact1.id}`, "GET");
        chai.assert.equal(contact1Values.body.length, 4);

        const contact1AttachGenericCode0 = contact1Values.body.find(v => v.attachedFromValueId === testData[0].genericCode.id);
        chai.assert.equal(contact1AttachGenericCode0.balance, 500);

        const contact1AttachGenericCode1 = contact1Values.body.find(v => v.attachedFromValueId === testData[1].genericCode.id);
        chai.assert.equal(contact1AttachGenericCode1.balance, 0);

        const contact1AttachGenericCode2 = contact1Values.body.find(v => v.attachedFromValueId === testData[2].genericCode.id);
        chai.assert.deepEqual(contact1AttachGenericCode2.balanceRule, testData[2].genericCode.balanceRule);
        chai.assert.equal(contact1AttachGenericCode2.usesRemaining, 1, "generic code 2 has usesRemaining set so each contact gets 1 use");

        const contact1AttachGenericCode3 = contact1Values.body.find(v => v.attachedFromValueId === testData[3].genericCode.id);
        chai.assert.deepEqual(contact1AttachGenericCode3.balanceRule, testData[3].genericCode.balanceRule);
        chai.assert.isNull(contact1AttachGenericCode3.usesRemaining, "generic code 3 has null usesRemaining so every contact gets indefinite uses");

        // contact 2 assertions
        const contact2Values = await testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contact2.id}`, "GET");
        chai.assert.equal(contact2Values.body.length, 2);

        const contact2AttachGenericCode2 = contact2Values.body.find(v => v.attachedFromValueId === testData[2].genericCode.id);
        chai.assert.deepEqual(contact2AttachGenericCode2.balanceRule, testData[2].genericCode.balanceRule);
        chai.assert.equal(contact2AttachGenericCode2.usesRemaining, 1, "generic code 2 has usesRemaining set so each contact gets 1 use");

        const contact2AttachGenericCode3 = contact2Values.body.find(v => v.attachedFromValueId === testData[3].genericCode.id);
        chai.assert.deepEqual(contact2AttachGenericCode3.balanceRule, testData[3].genericCode.balanceRule);
        chai.assert.isNull(contact2AttachGenericCode3.usesRemaining, "generic code 3 has null usesRemaining so every contact gets indefinite uses");

        // assert transactions contact 1
        const txContact1GC0 = await testAuthedRequest<Transaction>(router, `/v2/transactions/${contact1AttachGenericCode0.id}`, "GET");
        chai.assert.equal(txContact1GC0.body.transactionType, "attach");
        chai.assert.deepEqual(txContact1GC0.body.steps, [
            {
                "rail": "lightrail",
                "valueId": testData[0].genericCode.id,
                "contactId": null,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            },
            {
                "rail": "lightrail",
                "valueId": contact1AttachGenericCode0.id,
                "contactId": contact1.id,
                "code": null,
                "balanceBefore": 0,
                "balanceAfter": 500,
                "balanceChange": 500,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            }
        ]);

        const txContact1GC1 = await testAuthedRequest<Transaction>(router, `/v2/transactions/${contact1AttachGenericCode1.id}`, "GET");
        chai.assert.equal(txContact1GC1.body.transactionType, "attach");
        chai.assert.deepEqual(txContact1GC1.body.steps, [
            {
                "rail": "lightrail",
                "valueId": testData[1].genericCode.id,
                "contactId": null,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            },
            {
                "rail": "lightrail",
                "valueId": contact1AttachGenericCode1.id,
                "contactId": contact1.id,
                "code": null,
                "balanceBefore": 0,
                "balanceAfter": 0,
                "balanceChange": 0,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            }
        ]);

        const txContact1GC2 = await testAuthedRequest<Transaction>(router, `/v2/transactions/${contact1AttachGenericCode2.id}`, "GET");
        chai.assert.equal(txContact1GC2.body.transactionType, "attach");
        chai.assert.deepEqual(txContact1GC2.body.steps, [
            {
                "rail": "lightrail",
                "valueId": testData[2].genericCode.id,
                "contactId": null,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            },
            {
                "rail": "lightrail",
                "valueId": contact1AttachGenericCode2.id,
                "contactId": contact1.id,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": 0,
                "usesRemainingAfter": 1,
                "usesRemainingChange": 1
            }
        ]);

        const txContact1GC3 = await testAuthedRequest<Transaction>(router, `/v2/transactions/${contact1AttachGenericCode3.id}`, "GET");
        chai.assert.equal(txContact1GC3.body.transactionType, "attach");
        chai.assert.deepEqual(txContact1GC3.body.steps, [
            {
                "rail": "lightrail",
                "valueId": testData[3].genericCode.id,
                "contactId": null,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            },
            {
                "rail": "lightrail",
                "valueId": contact1AttachGenericCode3.id,
                "contactId": contact1.id,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            }
        ]);

        // assert contact 2 transactions
        const txContact2GC2 = await testAuthedRequest<Transaction>(router, `/v2/transactions/${contact2AttachGenericCode2.id}`, "GET");
        chai.assert.equal(txContact2GC2.body.transactionType, "attach");
        chai.assert.deepEqual(txContact2GC2.body.steps, [
            {
                "rail": "lightrail",
                "valueId": testData[2].genericCode.id,
                "contactId": null,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            },
            {
                "rail": "lightrail",
                "valueId": contact2AttachGenericCode2.id,
                "contactId": contact2.id,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": 0,
                "usesRemainingAfter": 1,
                "usesRemainingChange": 1
            }
        ]);

        const txContact2GC3 = await testAuthedRequest<Transaction>(router, `/v2/transactions/${contact2AttachGenericCode3.id}`, "GET");
        chai.assert.equal(txContact2GC3.body.transactionType, "attach");
        chai.assert.deepEqual(txContact2GC3.body.steps, [
            {
                "rail": "lightrail",
                "valueId": testData[3].genericCode.id,
                "contactId": null,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            },
            {
                "rail": "lightrail",
                "valueId": contact2AttachGenericCode3.id,
                "contactId": contact2.id,
                "code": null,
                "balanceBefore": null,
                "balanceAfter": null,
                "balanceChange": null,
                "usesRemainingBefore": null,
                "usesRemainingAfter": null,
                "usesRemainingChange": null
            }
        ]);
    }).timeout(15000);
});

export async function attachSharedGenericValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, value: Value): Promise<DbContactValue> {
    const dbContactValue: DbContactValue = {
        userId: auth.userId,
        valueId: value.id,
        contactId: contactId,
        createdDate: nowInDbPrecision(),
    };

    const knex = await getKnexWrite();
    await knex.transaction(async trx => {
        try {
            await trx("ContactValues")
                .insert(dbContactValue);
        } catch (err) {
            const constraint = getSqlErrorConstraintName(err);
            if (constraint === "PRIMARY") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `The Value '${value.id}' has already been attached to the Contact '${contactId}'.`, "ValueAlreadyAttached");
            }
            if (constraint === "fk_ContactValues_Contacts") {
                throw new giftbitRoutes.GiftbitRestError(404, `Contact with id '${contactId}' not found.`, "ContactNotFound");
            }
            if (constraint === "fk_ContactValues_Values") {
                throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${value.id}' not found.`, "ValueNotFound");
            }
            throw err;
        }
    });
    return dbContactValue;
}
import * as cassava from "cassava";
import * as chai from "chai";
import * as testUtils from "../../utils/testUtils";
import {
    alternateTestUser,
    defaultTestUser,
    generateId,
    setCodeCryptographySecrets,
    testAuthedRequest
} from "../../utils/testUtils";
import {Currency} from "../../model/Currency";
import chaiExclude from "chai-exclude";
import {getSqlErrorConstraintName, nowInDbPrecision} from "../../utils/dbUtils";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {Value} from "../../model/Value";
import {DbContactValue} from "../../model/DbContactValue";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {Contact} from "../../model/Contact";
import {Transaction} from "../../model/Transaction";
import {migrateContactValues, migrateContactValuesForUser} from "./contactValueMigration";
import {installRestRoutes} from "../rest/installRestRoutes";
import {createCurrency} from "../rest/currencies";

chai.use(chaiExclude);

// Temporary test file that can be removed once the contact value migration is removed.
describe("contact value migration", () => {

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
                // before migration V36 this would have had a balance = 500
                // this is what it will look like after
                genericCodeOptions: {
                    perContact: {
                        balance: 500,
                        usesRemaining: null
                    }
                }
            },
            attachedContacts: [contact1]
        },
        {
            genericCode: {
                ...genericCodeBaseProps,
                id: generateId() + "1",
                // before migration V36 this would have had a balance = 0
                // this is what it will look like after
                genericCodeOptions: {
                    perContact: {
                        balance: 0,
                        usesRemaining: null
                    }
                }
            },
            attachedContacts: [contact1]
        },
        {
            genericCode: {
                ...genericCodeBaseProps,
                id: generateId() + "2",
                balanceRule: {rule: "2", explanation: "2 cents off all items"},
                usesRemaining: 50, // migration V36 will set perContact.usesRemaining = 1
                genericCodeOptions: {
                    perContact: {
                        balance: null,
                        usesRemaining: 1
                    }
                }
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

    it("can migrate shared generic codes", async () => {
        for (const data of testData) {
            const createGenericCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", data.genericCode);
            chai.assert.equal(createGenericCode.statusCode, 201, `Failed creating: ${JSON.stringify(createGenericCode.body)}`);

            for (const contact of data.attachedContacts) {
                await attachSharedGenericValue(testUtils.defaultTestUser.auth, contact.id, createGenericCode.body);
            }
        }

        const knexRead = await getKnexRead();

        const contactValuesBefore: DbContactValue[] = await knexRead("ContactValues")
            .select("*");
        contactValuesBefore.forEach(cv => {
            chai.assert.isFalse(cv.migrated);
        });

        const migrate = await migrateContactValuesForUser(testUtils.defaultTestUser.userId);
        chai.assert.equal(migrate.userId, defaultTestUser.userId);
        chai.assert.equal(migrate.countOfContactValues, 6);
        chai.assert.equal(migrate.skippedMigrationConflicts, 0);
        chai.assert.equal(migrate.countOfSharedGenericCodes, 4);
        chai.assert.sameMembers(migrate.genericCodeIdList, [testData[0].genericCode.id, testData[1].genericCode.id, testData[2].genericCode.id, testData[3].genericCode.id]);

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

        const contactValuesAfter: DbContactValue[] = await knexRead("ContactValues")
            .select("*");
        contactValuesAfter.forEach(cv => {
            chai.assert.isTrue(cv.migrated);
        });
    }).timeout(15000);

    it("can migrate 10,000 contact values", async () => {
        const gc: Partial<Value> = {
            ...genericCodeBaseProps,
            id: generateId(),
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
        };
        const createGenericCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", gc);
        chai.assert.equal(createGenericCode.statusCode, 201, `Failed creating: ${JSON.stringify(createGenericCode.body)}`);

        for (let i = 0; i < 10000; i++) {
            const contactId = generateId();
            const createContact = await testUtils.testAuthedRequest<Value>(router, "/v2/contacts", "POST", {
                id: contactId
            });
            chai.assert.equal(createContact.statusCode, 201, `Failed creating: ${JSON.stringify(createContact.body)}`);
            await attachSharedGenericValue(testUtils.defaultTestUser.auth, contactId, createGenericCode.body);
        }

        const migrate = await migrateContactValuesForUser(testUtils.defaultTestUser.userId);
        chai.assert.deepEqual(migrate,
            {
                userId: testUtils.defaultTestUser.userId,
                countOfContactValues: 10000,
                skippedMigrationConflicts: 0,
                countOfSharedGenericCodes: 1,
                genericCodeIdList: [gc.id]
            }
        );
    }).timeout(300000);

    it("can migrate all shared generic codes for all users", async () => {
        // user1
        const gc: Partial<Value> = {
            ...genericCodeBaseProps,
            id: generateId(),
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
        };
        const createGenericCodeUser1 = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", gc);
        chai.assert.equal(createGenericCodeUser1.statusCode, 201);

        const createContactUser1 = await testUtils.testAuthedRequest<Value>(router, "/v2/contacts", "POST", {
            id: generateId()
        });
        chai.assert.equal(createContactUser1.statusCode, 201, `Failed creating: ${JSON.stringify(createContactUser1.body)}`);

        await attachSharedGenericValue(testUtils.defaultTestUser.auth, createContactUser1.body.id, createGenericCodeUser1.body);

        // user2
        const createCurrencyUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/currencies", "POST", {
            headers: {Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`},
            body: JSON.stringify(currency)
        }));
        chai.assert.equal(createCurrencyUser2.statusCode, 201);

        const createGenericCodeUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
            headers: {Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`},
            body: JSON.stringify(gc)
        }));
        chai.assert.equal(createGenericCodeUser2.statusCode, 201);

        const createContactUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/contacts", "POST", {
            headers: {Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`},
            body: JSON.stringify({id: generateId()})
        }));
        chai.assert.equal(createContactUser2.statusCode, 201, `Failed creating: ${JSON.stringify(createContactUser1.body)}`);

        await attachSharedGenericValue(testUtils.alternateTestUser.auth, JSON.parse(createContactUser2.body).id, JSON.parse(createGenericCodeUser2.body));

        const res = await migrateContactValues();
        chai.assert.sameDeepMembers(res, [
            {
                userId: defaultTestUser.userId,
                countOfContactValues: 1,
                skippedMigrationConflicts: 0,
                countOfSharedGenericCodes: 1,
                genericCodeIdList: [createGenericCodeUser1.body.id]
            },
            {
                userId: alternateTestUser.userId,
                countOfContactValues: 1,
                skippedMigrationConflicts: 0,
                countOfSharedGenericCodes: 1,
                genericCodeIdList: [JSON.parse(createGenericCodeUser2.body).id]
            }
        ]);
    });

    it("will ignore conflict exceptions if a shared generic code was also attached as a unique value for a particular contact", async () => {
        const gc: Partial<Value> = {
            ...genericCodeBaseProps,
            id: generateId(),
            balanceRule: {
                rule: "500 + value.balanceChange",
                explanation: "$5 off"
            }
        };
        const createGenericCode = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", gc);
        chai.assert.equal(createGenericCode.statusCode, 201, `Failed creating: ${JSON.stringify(createGenericCode.body)}`);

        const contactId = generateId();
        const createContact = await testUtils.testAuthedRequest<Value>(router, "/v2/contacts", "POST", {
            id: contactId
        });
        chai.assert.equal(createContact.statusCode, 201, `Failed creating: ${JSON.stringify(createContact.body)}`);
        await attachSharedGenericValue(testUtils.defaultTestUser.auth, contactId, createGenericCode.body);

        const attachResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contactId}/values/attach`, "POST", {
            valueId: gc.id,
            attachGenericAsNewValue: true
        });
        chai.assert.equal(attachResp.statusCode, 200);

        const migrate = await migrateContactValuesForUser(testUtils.defaultTestUser.userId);
        chai.assert.deepEqual(migrate, {
                "userId": testUtils.defaultTestUser.userId,
                "countOfContactValues": 1,
                "skippedMigrationConflicts": 1,
                "countOfSharedGenericCodes": 1,
                "genericCodeIdList": [
                    gc.id
                ]
            }
        );

        const knexRead = await getKnexRead();

        const contactValuesAfter: DbContactValue[] = await knexRead("ContactValues")
            .select("*")
            .where({
                userId: testUtils.defaultTestUser.userId,
                contactId: contactId,
                valueId: gc.id
            });
        chai.assert.equal(contactValuesAfter.length, 1);
        chai.assert.isTrue(contactValuesAfter[0].migrated);
    });

});

// Legacy function moved from contactValues.ts, now used to test that existing shared generic codes will still function correctly.
async function attachSharedGenericValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contactId: string, value: Value): Promise<DbContactValue> {
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
import * as cassava from "cassava";
import * as chai from "chai";
import {Currency} from "../../../model/Currency";
import * as testUtils from "../../../utils/testUtils";
import {defaultTestUser, generateId, setCodeCryptographySecrets, testAuthedRequest} from "../../../utils/testUtils";
import {installRestRoutes} from "../installRestRoutes";
import {createCurrency} from "../currencies";
import {createContact} from "../contacts";
import {Contact} from "../../../model/Contact";
import {
    getLightrailValuesForTransactionPlanSteps,
    ResolveTransactionPartiesOptions,
    resolveTransactionPlanSteps
} from "./resolveTransactionPlanSteps";
import {LightrailTransactionPlanStep} from "./TransactionPlan";
import {AttachedContactValueScenario, setupAttachedContactValueScenario} from "../contactValues.test";
import {LightrailTransactionParty, TransactionParty} from "../../../model/TransactionRequest";
import {Value} from "../../../model/Value";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {nowInDbPrecision} from "../../../utils/dbUtils";
import {attachSharedGenericValue} from "../sharedGenericCodeMigration.test";

describe("resolveTransactionPlanSteps", () => {

    const router = new cassava.Router();

    const currency: Currency = {
        code: "AUD",
        decimalPlaces: 2,
        symbol: "$",
        name: "Dollarydoo",
        createdDate: nowInDbPrecision(),
        updatedDate: nowInDbPrecision(),
        createdBy: testUtils.defaultTestUser.teamMemberId
    };

    const contact: Contact = {
        id: "c-1",
        firstName: null,
        lastName: null,
        email: null,
        metadata: null,
        createdDate: nowInDbPrecision(),
        updatedDate: nowInDbPrecision(),
        createdBy: defaultTestUser.auth.teamMemberId
    };

    before(async function () {
        await testUtils.resetDb();
        router.route(testUtils.authRoute);
        installRestRoutes(router);
        setCodeCryptographySecrets();
        await createCurrency(testUtils.defaultTestUser.auth, currency);
        await createContact(testUtils.defaultTestUser.auth, contact);
    });

    describe("can resolve transaction parties for contacts with attached Values", () => {
        let data: AttachedContactValueScenario;
        before(async () => {
            data = await setupAttachedContactValueScenario(router, currency);
        });

        const resolvePartiesOptions: ResolveTransactionPartiesOptions = {
            currency: currency.code,
            transactionId: "1",
            nonTransactableHandling: "include",
            includeZeroUsesRemaining: true,
            includeZeroBalance: true
        };

        it("can get lightrail transaction plan steps associated with contactA", async () => {
            const parties: TransactionParty[] = [
                {
                    rail: "lightrail",
                    contactId: data.contactA.id
                }
            ];
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, parties, resolvePartiesOptions);
            chai.assert.sameMembers(contactLightrailValues.map(v => (v as LightrailTransactionPlanStep).value.id), data.valuesAttachedToContactA.map(v => v.id));
        });

        it("can get lightrail transaction plan steps associated with contactB", async () => {
            const parties: TransactionParty[] = [
                {
                    rail: "lightrail",
                    contactId: data.contactB.id
                }
            ];
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, parties, resolvePartiesOptions);
            chai.assert.sameMembers(contactLightrailValues.map(v => (v as LightrailTransactionPlanStep).value.id), data.valuesAttachedToContactB.map(v => v.id));
        });

        it("can get lightrail transaction plan steps associated with contactA and contactB. Allows both contacts to use shared generic Value.", async () => {
            const parties: TransactionParty[] = [
                {
                    rail: "lightrail",
                    contactId: data.contactA.id
                },
                {
                    rail: "lightrail",
                    contactId: data.contactB.id
                }
            ];
            const contactLightrailValues = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth, parties, resolvePartiesOptions);

            const attachedValues = [...data.valuesAttachedToContactA, ...data.valuesAttachedToContactB];
            chai.assert.sameMembers(contactLightrailValues.map(v => (v as LightrailTransactionPlanStep).value.id), attachedValues.map(v => v.id));
        });

        describe("getLightrailValuesForTransactionPlanSteps", () => {
            const currency = {
                code: "USD"
            };
            const contact1: Partial<Contact> = {id: testUtils.generateId(8)};
            const contact2: Partial<Contact> = {id: testUtils.generateId(8)};
            const code1 = "ABCABC-DEFDEF";
            const code2 = "GHIGHI-JKLJKL";
            let value1_uniqueCode: Partial<Value> = {id: `value1_uniqueCode_${testUtils.generateId(5)}`, code: code1};
            let value2_uniqueCodeContact: Partial<Value> = {
                id: `value2_uniqueCodeContact_${testUtils.generateId(5)}`,
                code: code2,
                contactId: contact1.id,
            };
            let value3_sharedGeneric: Partial<Value> = {
                id: `value3_sharedGeneric_${testUtils.generateId(5)}`,
                code: `SHARE-GEN-3`,
                isGenericCode: true,
                balanceRule: {
                    rule: "500",
                    explanation: "500"
                },
                balance: null
            };
            let value4_perContactGeneric: Partial<Value> = {
                id: `value4_perContactGeneric_${testUtils.generateId(5)}`,
                isGenericCode: true,
                balanceRule: {
                    rule: "500",
                    explanation: "500"
                },
                balance: null,
                genericCodeOptions: {
                    perContact: {
                        usesRemaining: 2,
                        balance: null
                    }
                }
            };
            let contact1_attachedValues: Value[] = [];
            let contact2_attachedValues: Value[] = [];

            /**
             * Returns enough identifers to assert that the value is the one we expect without needing to exclude dates etc
             */
            function mapValueIdentifiers(value: Value) {
                return {
                    id: value.id,
                    attachedFromValueId: value.attachedFromValueId,
                    contactId: value.isGenericCode && !value.genericCodeOptions ? null : value.contactId,
                    code: value.code
                };
            }

            before(async () => {
                await testUtils.createUSD(router);

                const createContact1Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact1);
                chai.assert.equal(createContact1Resp.statusCode, 201);
                const createContact2Resp = await testUtils.testAuthedRequest<Contact>(router, "/v2/contacts", "POST", contact2);
                chai.assert.equal(createContact2Resp.statusCode, 201);

                value1_uniqueCode = await testUtils.createUSDValue(router, value1_uniqueCode);
                value2_uniqueCodeContact = await testUtils.createUSDValue(router, value2_uniqueCodeContact);
                contact1_attachedValues.push(value2_uniqueCodeContact as Value);
                value3_sharedGeneric = await testUtils.createUSDValue(router, value3_sharedGeneric);
                value4_perContactGeneric = await testUtils.createUSDValue(router, value4_perContactGeneric);

                const attachSharedResp = await attachSharedGenericValue(testUtils.defaultTestUser.auth, contact1.id, value3_sharedGeneric as Value);
                contact1_attachedValues.push(value3_sharedGeneric as Value);

                const attachPerContactResp = await testUtils.testAuthedRequest<Value>(router, `/v2/contacts/${contact2.id}/values/attach`, "POST", {valueId: value4_perContactGeneric.id});
                chai.assert.equal(attachPerContactResp.statusCode, 200);
                contact2_attachedValues.push(attachPerContactResp.body);
            });

            beforeEach(async () => {
                // make sure that the cached list of values attached to each contact is accurate
                const contact1ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contact1.id}`, "GET");
                chai.assert.equal(contact1ValuesResp.statusCode, 200, `contact1ValuesResp.body=${JSON.stringify(contact1ValuesResp.body)}`);
                chai.assert.sameDeepMembers(contact1ValuesResp.body.map(v => mapValueIdentifiers(v)), contact1_attachedValues.map(v => mapValueIdentifiers(v)), `fetched values for contact1 do not match cached list: fetched=${JSON.stringify(contact1ValuesResp.body)}, cached=${JSON.stringify(contact1_attachedValues)}`);

                const contact2ValuesResp = await testUtils.testAuthedRequest<Value[]>(router, `/v2/values?contactId=${contact2.id}`, "GET");
                chai.assert.equal(contact2ValuesResp.statusCode, 200, `contact2ValuesResp.body=${JSON.stringify(contact2ValuesResp.body)}`);
                chai.assert.sameDeepMembers(contact2ValuesResp.body.map(v => mapValueIdentifiers(v)), contact2_attachedValues.map(v => mapValueIdentifiers(v)), `fetched values for contact2 do not match cached list: fetched=${JSON.stringify(contact2ValuesResp.body)}, cached=${JSON.stringify(contact2_attachedValues)}`);
            });

            it("gets values associated with one contactId", async () => {
                const contact2AsTransactionSource: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    contactId: contact2.id
                }];
                const valuesByContactId2 = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, contact2AsTransactionSource, resolvePartiesOptions);
                chai.assert.equal(valuesByContactId2.length, 1, `valuesByContactId2: ${JSON.stringify(valuesByContactId2)}`);
                chai.assert.sameDeepMembers(valuesByContactId2.map(v => mapValueIdentifiers(v)), contact2_attachedValues.map(v => mapValueIdentifiers(v)), `valuesByContactId2=${JSON.stringify(valuesByContactId2)}`);

                const contact1AsTransactionSource: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    contactId: contact1.id
                }];
                const valuesByContactId1 = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, contact1AsTransactionSource, resolvePartiesOptions);
                chai.assert.sameDeepMembers(valuesByContactId1.map(v => mapValueIdentifiers(v)), contact1_attachedValues.map(v => mapValueIdentifiers(v)), `valuesByContactId1=${JSON.stringify(valuesByContactId1)}`);
            });

            it("gets values associated with two contactIds", async () => {
                const contactsAsTransactionSources: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    contactId: contact1.id
                }, {
                    rail: "lightrail",
                    contactId: contact2.id
                }];
                const valuesByContactIds = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, contactsAsTransactionSources, resolvePartiesOptions);
                chai.assert.sameDeepMembers(valuesByContactIds.map(v => mapValueIdentifiers(v)), [...contact1_attachedValues, ...contact2_attachedValues].map(v => mapValueIdentifiers(v)), `valuesByContactIds=${JSON.stringify(valuesByContactIds)}`);
            });

            it("gets values by code", async () => {
                const codeAsTransactionSource: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    code: code1
                }];
                const valuesByCode1 = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, codeAsTransactionSource, resolvePartiesOptions);
                chai.assert.equal(valuesByCode1.length, 1);
                chai.assert.deepEqualExcluding(valuesByCode1[0], value1_uniqueCode, ["createdDate", "updatedDate", "genericCodeOptions", "attachedFromValueId", "updatedContactIdDate"]);

                const twoCodesAsTransactionSource: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    code: code1
                }, {
                    rail: "lightrail",
                    code: code2
                }];
                const valuesByCode2 = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, twoCodesAsTransactionSource, resolvePartiesOptions);
                chai.assert.equal(valuesByCode2.length, 2);
                chai.assert.deepEqualExcluding(valuesByCode2, [value1_uniqueCode, value2_uniqueCodeContact], ["createdDate", "updatedDate", "genericCodeOptions", "attachedFromValueId", "updatedContactIdDate"]);
            });

            it("gets values by ID", async () => {
                const valueIdAsTransactionSource: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    valueId: value1_uniqueCode.id
                }];
                const valuesById1 = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, valueIdAsTransactionSource, resolvePartiesOptions);
                chai.assert.equal(valuesById1.length, 1);
                chai.assert.deepEqualExcluding(valuesById1[0], value1_uniqueCode, ["createdDate", "updatedDate", "genericCodeOptions", "attachedFromValueId", "updatedContactIdDate"]);

                const twoValueIdsAsTransactionSource: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    valueId: value1_uniqueCode.id
                }, {
                    rail: "lightrail",
                    valueId: value2_uniqueCodeContact.id
                }];
                const valuesById2 = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, twoValueIdsAsTransactionSource, resolvePartiesOptions);
                chai.assert.equal(valuesById2.length, 2);
                chai.assert.deepEqualExcluding(valuesById2.find(v => v.id === value1_uniqueCode.id), value1_uniqueCode, ["createdDate", "updatedDate", "genericCodeOptions", "attachedFromValueId", "updatedContactIdDate"]);
                chai.assert.deepEqualExcluding(valuesById2.find(v => v.id === value2_uniqueCodeContact.id), value2_uniqueCodeContact, ["createdDate", "updatedDate", "genericCodeOptions", "attachedFromValueId", "updatedContactIdDate"]);
            });

            describe("Value de-duplication", () => {
                it("does not duplicate shared generic Value if attached to contact in sources and also passed anonymously", async () => {
                    const dupedSources: LightrailTransactionParty[] = [{
                        rail: "lightrail",
                        code: value3_sharedGeneric.code // attached to contact1
                    }, {
                        rail: "lightrail",
                        contactId: contact1.id
                    }];
                    const values = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, dupedSources, resolvePartiesOptions);
                    chai.assert.sameDeepMembers(values.map(v => mapValueIdentifiers(v)), contact1_attachedValues.map(v => mapValueIdentifiers(v)), `values=${JSON.stringify(values)}`);
                });

                it("does not duplicate unique Value if attached to contact in sources and also passed in anonymously", async () => {
                    chai.assert.equal(value2_uniqueCodeContact.contactId, contact1.id, "value2_uniqueCodeContact should be attached to contact1");
                    const dupedSources: LightrailTransactionParty[] = [{
                        rail: "lightrail",
                        valueId: value2_uniqueCodeContact.id
                    }, {
                        rail: "lightrail",
                        contactId: value2_uniqueCodeContact.contactId
                    }];
                    const values = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, dupedSources, resolvePartiesOptions);
                    chai.assert.sameDeepMembers(values.map(v => mapValueIdentifiers(v)), contact1_attachedValues.map(v => mapValueIdentifiers(v)));
                });

                it("does not duplicate attached values passed in by different identifiers", async () => {
                    const dupedSources: LightrailTransactionParty[] = [{
                        rail: "lightrail",
                        valueId: value2_uniqueCodeContact.id
                    }, {
                        rail: "lightrail",
                        code: value2_uniqueCodeContact.code
                    }];
                    const values = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, dupedSources, resolvePartiesOptions);
                    chai.assert.equal(values.length, 1, `should only have one value: ${JSON.stringify(values)}`);
                    chai.assert.deepEqual(mapValueIdentifiers(values[0]), mapValueIdentifiers(value2_uniqueCodeContact as Value));
                });

                it("does not duplicate unattached values passed in by different identifiers", async () => {
                    chai.assert.isNull(value1_uniqueCode.contactId, "value1_uniqueCode should not be attached to a contact");
                    const dupedSources: LightrailTransactionParty[] = [{
                        rail: "lightrail",
                        valueId: value1_uniqueCode.id
                    }, {
                        rail: "lightrail",
                        code: value1_uniqueCode.code
                    }];
                    const values = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, dupedSources, resolvePartiesOptions);
                    chai.assert.equal(values.length, 1, `should only have one value: ${JSON.stringify(values)}`);
                    chai.assert.deepEqual(mapValueIdentifiers(values[0]), mapValueIdentifiers(value1_uniqueCode as Value));
                });
            });

            it("gets multiple values by different identifiers", async () => {
                const multiIdentiferSources: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    code: code1
                }, {
                    rail: "lightrail",
                    valueId: value2_uniqueCodeContact.id
                }, {
                    rail: "lightrail",
                    contactId: contact2.id
                }];
                const options: ResolveTransactionPartiesOptions = {
                    ...resolvePartiesOptions,
                    currency: currency.code,
                    nonTransactableHandling: "exclude",
                    includeZeroBalance: false,
                    includeZeroUsesRemaining: false,
                };
                const values = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, multiIdentiferSources, options);
                chai.assert.sameDeepMembers(values.map(v => mapValueIdentifiers(v)), [value1_uniqueCode, value2_uniqueCodeContact, ...contact2_attachedValues].map(v => mapValueIdentifiers(v as Value)), `values=${JSON.stringify(values)}`);
            });

            it("excludes sources with zero balance when includeZeroBalance=false", async () => {
                const value1 = await testUtils.createUSDValue(router); // balance will get zeroed

                const source: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    valueId: value1.id
                }];
                const includeZeroBalanceOptions: ResolveTransactionPartiesOptions = {
                    ...resolvePartiesOptions,
                    includeZeroBalance: true
                };

                const valueShouldBeReturned = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, source, includeZeroBalanceOptions);
                chai.assert.equal(valueShouldBeReturned.length, 1);
                chai.assert.equal(valueShouldBeReturned[0].id, value1.id);

                const value1_zeroBalanceResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                    id: generateId(),
                    currency: currency.code,
                    amount: value1.balance,
                    source: {rail: "lightrail", valueId: value1.id}
                });
                chai.assert.equal(value1_zeroBalanceResp.statusCode, 201, `value1_zeroBalanceResp.body=${JSON.stringify(value1_zeroBalanceResp)}`);
                chai.assert.equal((value1_zeroBalanceResp.body.steps[0] as LightrailTransactionStep).balanceAfter, 0, `value1_zeroBalanceResp.body.steps=${value1_zeroBalanceResp.body.steps}`);

                const valueShouldStillBeReturned = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, source, includeZeroBalanceOptions);
                chai.assert.sameDeepMembers(valueShouldStillBeReturned.map(v => mapValueIdentifiers(v)), valueShouldBeReturned.map(v => mapValueIdentifiers(v)));

                const excludeZeroBalanceOptions: ResolveTransactionPartiesOptions = {
                    ...resolvePartiesOptions,
                    includeZeroBalance: false
                };
                const noValueReturned = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, source, excludeZeroBalanceOptions);
                chai.assert.equal(noValueReturned.length, 0);
            });

            it("excludes sources with zero usesRemaining when includeZeroUsesRemaining=false", async () => {
                const value2 = await testUtils.createUSDValue(router, {usesRemaining: 1}); // usesRemaining will get zeroed
                const source: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    valueId: value2.id
                }];
                const includeZeroUsesOptions: ResolveTransactionPartiesOptions = {
                    ...resolvePartiesOptions,
                    includeZeroUsesRemaining: true
                };

                const valueShouldBeReturned = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, source, includeZeroUsesOptions);
                chai.assert.equal(valueShouldBeReturned.length, 1);
                chai.assert.equal(valueShouldBeReturned[0].id, value2.id);

                const value2_zeroUsesRemainingResp = await testUtils.testAuthedRequest<Transaction>(router, "/v2/transactions/debit", "POST", {
                    id: generateId(),
                    currency: currency.code,
                    uses: value2.usesRemaining,
                    source: {rail: "lightrail", valueId: value2.id}
                });
                chai.assert.equal(value2_zeroUsesRemainingResp.statusCode, 201, `value2_zeroUsesRemainingResp.body=${JSON.stringify(value2_zeroUsesRemainingResp)}`);
                chai.assert.equal((value2_zeroUsesRemainingResp.body.steps[0] as LightrailTransactionStep).usesRemainingAfter, 0, `value2_zeroUsesRemainingResp.body.steps=${value2_zeroUsesRemainingResp.body.steps}`);

                const valueShouldStillBeReturned = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, source, includeZeroUsesOptions);
                chai.assert.sameDeepMembers(valueShouldStillBeReturned.map(v => mapValueIdentifiers(v)), valueShouldBeReturned.map(v => mapValueIdentifiers(v)));

                const excludeZeroUsesOptions: ResolveTransactionPartiesOptions = {
                    ...includeZeroUsesOptions,
                    includeZeroUsesRemaining: false
                };
                const noValueReturned = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, source, excludeZeroUsesOptions);
                chai.assert.equal(noValueReturned.length, 0);
            });

            it("properly excludes sources when nonTransactableHandling='exclude'", async () => {
                const currency2: Partial<Currency> = {
                    code: "CCC",
                    name: "Currency123",
                    symbol: "$",
                    decimalPlaces: 3
                };
                const createCurrency2Resp = await testUtils.testAuthedRequest<Currency>(router, "/v2/currencies", "POST", currency2);
                chai.assert.equal(createCurrency2Resp.statusCode, 201);

                // setup: create a bunch of values that should be returned when nonTransactableHandling='include' and includeZeroBalance=true and includeZeroUsesRemaining=true
                const value3 = await testUtils.createUSDValue(router); // will get cancelled
                const value4 = await testUtils.createUSDValue(router); // will get frozen
                const value5 = await testUtils.createUSDValue(router); // will get set to 'inactive'
                const value6: Partial<Value> = {
                    id: generateId(),
                    currency: currency2.code,
                    balance: 50
                }; // wrong currency
                const createValue6Resp = await testUtils.testAuthedRequest<Value>(router, "/v2/values", "POST", value6);
                chai.assert.equal(createValue6Resp.statusCode, 201);
                const value7 = await testUtils.createUSDValue(router, {startDate: new Date("2040-01-01T00:00:00.000Z")}); // start date in future
                const value8 = await testUtils.createUSDValue(router, {endDate: new Date("2000-01-01T00:00:00.000Z")}); // expired

                // check that they're all initially returned
                const sources: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    valueId: value3.id
                }, {
                    rail: "lightrail",
                    valueId: value4.id
                }, {
                    rail: "lightrail",
                    valueId: value5.id
                }, {
                    rail: "lightrail",
                    valueId: value6.id
                }, {
                    rail: "lightrail",
                    valueId: value7.id
                }, {
                    rail: "lightrail",
                    valueId: value8.id
                }];
                const includeNonTransactableOptions: ResolveTransactionPartiesOptions = {
                    currency: currency.code,
                    transactionId: "1",
                    nonTransactableHandling: "include",
                    includeZeroUsesRemaining: true,
                    includeZeroBalance: true
                };

                const valuesWhileAllValid = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, sources, includeNonTransactableOptions);
                chai.assert.equal(valuesWhileAllValid.length, 6);
                chai.assert.sameMembers(valuesWhileAllValid.map(v => v.id), [value3.id, value4.id, value5.id, value6.id, value7.id, value8.id]);

                // update values so they're all non-transactable
                const value3_cancelResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value3.id}`, "PATCH", {canceled: true});
                chai.assert.equal(value3_cancelResp.statusCode, 200, `value3_cancelResp.body=${JSON.stringify(value3_cancelResp)}`);
                chai.assert.equal(value3_cancelResp.body.canceled, true, `value3_cancelResp.body.canceled=${value3_cancelResp.body.canceled}`);

                const value4_freezeResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value4.id}`, "PATCH", {frozen: true});
                chai.assert.equal(value4_freezeResp.statusCode, 200, `value4_freezeResp.body=${JSON.stringify(value4_freezeResp)}`);
                chai.assert.equal(value4_freezeResp.body.frozen, true, `value4_freezeResp.body.frozen=${value4_freezeResp.body.frozen}`);

                const value5_inactivateResp = await testUtils.testAuthedRequest<Value>(router, `/v2/values/${value5.id}`, "PATCH", {active: false});
                chai.assert.equal(value5_inactivateResp.statusCode, 200, `value5_inactivateResp.body=${JSON.stringify(value5_inactivateResp)}`);
                chai.assert.equal(value5_inactivateResp.body.active, false, `value5_inactivateResp.body.active=${value5_inactivateResp.body.active}`);

                // check that they still get returned when including non-transactable sources
                const valuesAfterInvalidation = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, sources, includeNonTransactableOptions);
                chai.assert.sameDeepMembers(valuesAfterInvalidation.map(v => mapValueIdentifiers(v)), valuesWhileAllValid.map(v => mapValueIdentifiers(v)));

                // check that they DON'T get returned when excluding non-transactable sources
                const excludeNonTransactableOptions: ResolveTransactionPartiesOptions = {
                    ...includeNonTransactableOptions,
                    nonTransactableHandling: "exclude",
                };
                const noValuesAfterInvalidation = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, sources, excludeNonTransactableOptions);
                chai.assert.equal(noValuesAfterInvalidation.length, 0);
            });

            it("doesn't fail if invalid sources included (code/valueId/contactId does not exist): successfully returns valid sources", async () => {
                const sources: LightrailTransactionParty[] = [{
                    rail: "lightrail",
                    code: generateId()
                }, {
                    rail: "lightrail",
                    contactId: generateId()
                }, {
                    rail: "lightrail",
                    valueId: value1_uniqueCode.id
                }];
                const values = await getLightrailValuesForTransactionPlanSteps(testUtils.defaultTestUser.auth, sources, resolvePartiesOptions);
                chai.assert.equal(values.length, 1);
                chai.assert.deepEqualExcluding(values[0], value1_uniqueCode, ["createdDate", "updatedDate", "genericCodeOptions", "attachedFromValueId", "updatedContactIdDate"]);
            });

            it("does not leak Values between userIds", async () => {
                // identical Value & Contact will be created for two different Lightrail users
                const value: Partial<Value> = {
                    id: "share-gen-1",
                    isGenericCode: true,
                    currency: "USD",
                    balanceRule: {
                        rule: "500",
                        explanation: "500"
                    }
                };
                const contact: Partial<Contact> = {
                    id: "contact-1"
                };

                // set up data for first user
                const currencyUser1 = await testAuthedRequest(router, "/v2/currencies/USD", "GET"); // created in before()
                chai.assert.equal(currencyUser1.statusCode, 200, `currencyUser1.body=${JSON.stringify(currencyUser1.body)}`);
                const valueUser1 = await testAuthedRequest(router, "/v2/values", "POST", value);
                chai.assert.equal(valueUser1.statusCode, 201, `valueUser1.body=${JSON.stringify(valueUser1.body)}`);
                const contactUser1 = await testAuthedRequest(router, "/v2/contacts", "POST", contact);
                chai.assert.equal(contactUser1.statusCode, 201, `contactUser1.body=${JSON.stringify(contactUser1.body)}`);
                const attachUser1 = await testAuthedRequest(router, `/v2/contacts/${contact.id}/values/attach`, "POST", {valueId: value.id});
                chai.assert.equal(attachUser1.statusCode, 200, `attachUser1.body=${JSON.stringify(attachUser1.body)}`);

                // set up data for second user
                const currencyUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/currencies", "POST", {
                    headers: {
                        Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                    },
                    body: JSON.stringify({
                        code: "USD",
                        symbol: "$",
                        decimalPlaces: 2,
                        name: "USD"
                    })
                }));
                chai.assert.equal(currencyUser2.statusCode, 201, `currencyUser2.body=${JSON.stringify(currencyUser2.body)}`);
                const valueUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/values", "POST", {
                    headers: {
                        Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                    },
                    body: JSON.stringify(value)
                }));
                chai.assert.equal(valueUser2.statusCode, 201, `valueUser2.body=${JSON.stringify(valueUser2.body)}`);
                const contactUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent("/v2/contacts", "POST", {
                    headers: {
                        Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                    },
                    body: JSON.stringify(contact)
                }));
                chai.assert.equal(contactUser2.statusCode, 201, `contactUser2.body=${JSON.stringify(contactUser2.body)}`);
                const attachUser2 = await cassava.testing.testRouter(router, cassava.testing.createTestProxyEvent(`/v2/contacts/${contact.id}/values/attach`, "POST", {
                    headers: {
                        Authorization: `Bearer ${testUtils.alternateTestUser.jwt}`
                    },
                    body: JSON.stringify({valueId: value.id})
                }));
                chai.assert.equal(attachUser2.statusCode, 200, `attachUser2.body=${JSON.stringify(attachUser2.body)}`);

                // the actual test: make sure the right data comes back for the right auth badge
                const resolvedValuesUser1 = await resolveTransactionPlanSteps(testUtils.defaultTestUser.auth,
                    [{
                        rail: "lightrail",
                        contactId: contact.id
                    }],
                    {
                        currency: "USD",
                        transactionId: "1",
                        nonTransactableHandling: "exclude",
                        includeZeroUsesRemaining: false,
                        includeZeroBalance: false
                    });
                chai.assert.equal(resolvedValuesUser1.length, 1, JSON.stringify(resolvedValuesUser1, null, 4));
            }).timeout(12000);
        });
    });
});

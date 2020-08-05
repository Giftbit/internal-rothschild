import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {DbValue, formatCodeForLastFourDisplay} from "../../model/Value";
import {getSqlErrorConstraintName} from "../../utils/dbUtils";
import {DbTransaction} from "../../model/Transaction";
import {DbTransactionStep} from "../../model/TransactionStep";
import {generateUrlSafeHashFromValueIdContactId} from "../rest/genericCode";
import {DbContactValue} from "../../model/DbContactValue";
import Knex = require("knex");
import log = require("loglevel");

interface DbObjectsForNewAttach {
    value: DbValue;
    transaction: DbTransaction;
    steps: DbTransactionStep[];
}

interface ContactValueMigration {
    userId: string;
    countOfContactValues: number;
    skippedMigrationConflicts: number;
    countOfSharedGenericCodes: number;
    genericCodeIdList: string[];
}

export async function migrateContactValues(): Promise<ContactValueMigration[]> {
    log.info(`Beginning ContactValue migration.`);
    const knexRead = await getKnexRead();
    const results: ContactValueMigration[] = [];

    log.info("Got database connection.");

    const users: { userId: string }[] = await knexRead("ContactValues")
        .select("userId")
        .groupBy("userId");

    for (const user of users) {
        results.push(await migrateContactValuesForUser(user.userId));
    }
    log.info(`Finished ContactValue migration. Results: ${results.map(result => JSON.stringify(result) + "\n")}`);
    return results;
}

// exported for test purposes
export async function migrateContactValuesForUser(userId: string): Promise<ContactValueMigration> {
    const stats: ContactValueMigration = {
        userId: userId,
        countOfContactValues: 0,
        skippedMigrationConflicts: 0,
        countOfSharedGenericCodes: 0,
        genericCodeIdList: []
    };

    const knexRead = await getKnexRead();
    const contactValues: DbContactValue[] = await knexRead("ContactValues")
        .select()
        .where({
            userId: userId,
            migrated: false
        });
    stats.countOfContactValues = contactValues.length;
    log.info(`Found ${stats.countOfContactValues} ContactValues to migrate for user ${userId}.`);

    const genericCodes: { [valueId: string]: DbValue } = {};
    const newValueAttaches: DbObjectsForNewAttach[] = [];
    for (const contactValue of contactValues) {
        if (!genericCodes[contactValue.valueId]) {
            genericCodes[contactValue.valueId] = await getGenericCode(knexRead, userId, contactValue.valueId);
        }

        const genericCode = genericCodes[contactValue.valueId];
        newValueAttaches.push(getObjectsForMigratingContactValue(contactValue, genericCode));
    }

    const knexWrite = await getKnexWrite();
    await knexWrite.transaction(async trx => {
        for (const newValueAttach of newValueAttaches) {
            try {
                await insertValue(trx, newValueAttach.value);
                await insertTransaction(trx, newValueAttach.transaction);
                await insertTransactionSteps(trx, newValueAttach.steps);
                await markContactValueAsMigrated(trx, userId, newValueAttach.value.contactId, newValueAttach.value.attachedFromValueId);
            } catch (err) {
                if (err instanceof cassava.RestError && err.statusCode === cassava.httpStatusCode.clientError.CONFLICT) {
                    log.info(`While migrating a contactValue it appears it may have already been attached as a new value. New Value Id: ${newValueAttach.value.id}. This is okay. It is possible to have attached a generic code as a shared generic and then also attach using attachGenericAsNewValue=true. Proceed with migration.`);
                    await markContactValueAsMigrated(trx, userId, newValueAttach.value.contactId, newValueAttach.value.attachedFromValueId);
                    stats.skippedMigrationConflicts++;
                } else {
                    throw err;
                }
            }
        }
    });

    stats.countOfSharedGenericCodes = Object.keys(genericCodes).length;
    stats.genericCodeIdList = Object.keys(genericCodes);
    return stats;
}

async function getGenericCode(knex: Knex, userId: string, id: string): Promise<DbValue> {
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: userId,
            id: id,
            isGenericCode: true
        });
    if (res.length === 0) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return res[0];
}

function getObjectsForMigratingContactValue(contactValue: DbContactValue, genericCode: DbValue): DbObjectsForNewAttach {
    const id = generateUrlSafeHashFromValueIdContactId(genericCode.id, contactValue.contactId);

    const value: DbValue = {
        ...genericCode,
        id: id,
        contactId: contactValue.contactId,
        balance: genericCode.genericCodeOptions_perContact_balance,
        usesRemaining: genericCode.usesRemaining == null ? null : genericCode.usesRemaining === 0 ? 0 : 1,
        createdDate: contactValue.createdDate,
        updatedDate: contactValue.createdDate,
        attachedFromValueId: genericCode.id,
        codeEncrypted: null,
        codeHashed: null,
        codeLastFour: null,
        isGenericCode: false,
        genericCodeOptions_perContact_balance: null,
        genericCodeOptions_perContact_usesRemaining: null,
        metadata: JSON.stringify({"lightrail_migration_note": "migrated from legacy shared generic code model"})
    };

    const transaction: DbTransaction = {
        userId: genericCode.userId,
        id: id,
        transactionType: "attach",
        currency: genericCode.currency,
        totals_subtotal: null,
        totals_tax: null,
        totals_discountLightrail: null,
        totals_paidLightrail: null,
        totals_paidStripe: null,
        totals_paidInternal: null,
        totals_remainder: null,
        totals_forgiven: null,
        totals_marketplace_sellerGross: null,
        totals_marketplace_sellerDiscount: null,
        totals_marketplace_sellerNet: null,
        lineItems: null,
        paymentSources: null,
        createdDate: contactValue.createdDate,
        createdBy: genericCode.userId,
        metadata: null,
        rootTransactionId: id,
        nextTransactionId: null,
        tax: null,
        pendingVoidDate: null,
    };

    const updateStep: DbTransactionStep = {
        userId: genericCode.userId,
        id: `${id}-0`,
        transactionId: id,
        valueId: genericCode.id,
        contactId: null,
        code: genericCode.codeLastFour ? formatCodeForLastFourDisplay(genericCode.codeLastFour) : null,
        balanceRule: null,
        balanceBefore: null,
        balanceAfter: null,
        balanceChange: null,
        usesRemainingBefore: null,
        usesRemainingAfter: null,
        usesRemainingChange: null,
    };

    const insertStep: DbTransactionStep = {
        userId: genericCode.userId,
        id: `${id}-1`,
        transactionId: id,
        valueId: value.id,
        contactId: value.contactId,
        code: null,
        balanceRule: null,
        balanceBefore: value.balance != null ? 0 : null,
        balanceAfter: value.balance,
        balanceChange: value.balance,
        usesRemainingBefore: value.usesRemaining != null ? 0 : null,
        usesRemainingAfter: value.usesRemaining,
        usesRemainingChange: value.usesRemaining,
    };

    return {
        value: value,
        transaction: transaction,
        steps: [updateStep, insertStep]
    };
}

async function insertValue(trx: Knex, dbValue: DbValue): Promise<void> {
    try {
        await trx("Values")
            .insert(dbValue);
    } catch (err) {
        log.debug(`Error inserting value ${JSON.stringify(dbValue)}`, err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with id '${dbValue.id}' already exists.`, "ValueIdExists");
        }
        throw err;
    }
}

async function insertTransaction(trx: Knex, dbTransaction: DbTransaction): Promise<void> {
    try {
        await trx("Transactions")
            .insert(dbTransaction);
    } catch (err) {
        log.debug(`Error inserting transaction ${JSON.stringify(dbTransaction)}`, err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Transaction with id '${dbTransaction.id}' already exists.`, "TransactionIdExists");
        }
        throw err;
    }
}

async function insertTransactionSteps(trx: Knex, dbSteps: DbTransactionStep[]): Promise<void> {
    try {
        await trx("LightrailTransactionSteps")
            .insert(dbSteps);
    } catch (err) {
        log.debug(`Error inserting steps ${JSON.stringify(dbSteps)}`, err);
        throw err;
    }
}

async function markContactValueAsMigrated(trx: Knex, userId: string, contactId: string, valueId: string): Promise<void> {
    const update = await trx("ContactValues")
        .where({
            userId: userId,
            contactId: contactId,
            valueId: valueId
        })
        .update({
            migrated: true
        });
    if (update === 0) {
        throw new cassava.RestError(404);
    }
    if (update > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${update} ContactValues.`);
    }
}
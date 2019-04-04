import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbValue, Value} from "../../model/Value";
import {getSqlErrorConstraintName} from "../../utils/dbUtils";
import * as cassava from "cassava";
import Knex = require("knex");
import log = require("loglevel");

export async function insertValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, trx: Knex, value: Value): Promise<DbValue> {
    if (value.balance < 0) {
        throw new Error("balance cannot be negative");
    }
    if (value.usesRemaining < 0) {
        throw new Error("usesRemaining cannot be negative");
    }

    const dbValue: DbValue = await Value.toDbValue(auth, value);
    try {
        await trx("Values")
            .insert(dbValue);

    } catch (err) {
        log.debug(err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with id '${value.id}' already exists.`, "ValueIdExists");
        }
        if (constraint === "uq_Values_codeHashed") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with the given code already exists.`, "ValueCodeExists");
        }
        if (constraint === "fk_Values_Currencies") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${value.currency}' does not exist. See the documentation on creating currencies.`, "CurrencyNotFound");
        }
        if (constraint === "fk_Values_Contacts") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact '${value.contactId}' does not exist.`, "ContactNotFound");
        }
        throw err;
    }

    return dbValue;
}
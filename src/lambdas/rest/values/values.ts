import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../../model/Pagination";
import {DbValue, formatCodeForLastFourDisplay, Value} from "../../../model/Value";
import {pick} from "../../../utils/pick";
import {csvSerializer} from "../../../utils/serializers";
import {
    dateInDbPrecision,
    filterAndPaginateQuery,
    getSqlErrorConstraintName,
    nowInDbPrecision
} from "../../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../../utils/dbUtils/connection";
import {DbCode} from "../../../model/DbCode";
import {generateCode} from "../../../utils/codeGenerator";
import {computeCodeLookupHash} from "../../../utils/codeCryptoUtils";
import {getProgram} from "../programs";
import {Program} from "../../../model/Program";
import {GenerateCodeParameters} from "../../../model/GenerateCodeParameters";
import {getTransactions} from "../transactions/transactions";
import {
    Currency,
    formatAmountForCurrencyDisplay,
    formatObjectsAmountPropertiesForCurrencyDisplay
} from "../../../model/Currency";
import {getCurrency} from "../currencies";
import {
    checkCodeParameters,
    checkValueProperties,
    createValue,
    setDiscountSellerLiabilityPropertiesForLegacySupport
} from "./createValue";
import {QueryBuilder} from "knex";
import {MetricsLogger} from "../../../utils/metricsLogger";
import {LightrailTransactionStep, Transaction} from "../../../model/Transaction";
import {ruleSchema} from "../transactions/rules/ruleSchema";
import {isSystemId} from "../../../utils/isSystemId";
import log = require("loglevel");
import getPaginationParams = Pagination.getPaginationParams;

export function installValuesRest(router: cassava.Router): void {
    router.route("/v2/values")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:list");

            const showCode: boolean = (evt.queryStringParameters.showCode === "true");
            const res = await getValues(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt), showCode);

            if (evt.queryStringParameters.stats === "true") {
                // For now this is a secret param only Yervana and Chairish know about.
                await injectValueStats(auth, res.values);
            }

            if (evt.queryStringParameters.formatCurrencies === "true") {
                return {
                    headers: Pagination.toHeaders(evt, res.pagination),
                    body: await formatObjectsAmountPropertiesForCurrencyDisplay(auth, res.values, [
                        "balance",
                        "genericCodeOptions.perContact.balance"
                    ])
                };

            } else {
                return {
                    headers: Pagination.toHeaders(evt, res.pagination),
                    body: res.values
                };
            }
        });

    router.route("/v2/values")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            if (auth.hasScope("lightrailV2:values:create:self") && evt.body && auth.valueId === evt.body.id) {
                // Badge is signed specifically to create this Value.
            } else {
                auth.requireScopes("lightrailV2:values:create");
            }
            evt.validateBody(valueSchema);

            let program: Program = null;
            if (evt.body.programId) {
                program = await getProgram(auth, evt.body.programId);
            }

            let value: Partial<Value> = evt.body;

            const knex = await getKnexWrite();
            await knex.transaction(async trx => {
                value = await createValue(auth, {
                        partialValue: value,
                        generateCodeParameters: evt.body.generateCode,
                        program: program
                    },
                    trx);
            });
            if (value.code && !value.isGenericCode && !(evt.queryStringParameters.showCode === "true")) {
                value.code = formatCodeForLastFourDisplay(value.code);
            }

            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: value
            };
        });

    router.route("/v2/values/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:values:read:self") && auth.valueId === evt.pathParameters.id) {
                // Badge is signed specifically to read this Value.
            } else {
                auth.requireScopes("lightrailV2:values:read");
            }

            const showCode: boolean = (evt.queryStringParameters.showCode === "true");
            const value = await getValue(auth, evt.pathParameters.id, showCode);

            if (evt.queryStringParameters.stats === "true") {
                // For now this is a secret param only Yervana and Chairish know about.
                await injectValueStats(auth, [value]);
            }

            return {
                body: value
            };
        });

    router.route("/v2/values/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:values:update:self") && auth.valueId === evt.pathParameters.id) {
                // Badge is signed specifically to patch this Value.
            } else {
                auth.requireScopes("lightrailV2:values:update");
            }
            evt.validateBody(valueUpdateSchema);

            if (evt.body.id && evt.body.id !== evt.pathParameters.id) {
                throw new giftbitRoutes.GiftbitRestError(422, `The body id '${evt.body.id}' does not match the path id '${evt.pathParameters.id}'.  The id cannot be updated.`);
            }

            const now = nowInDbPrecision();
            const value = {
                ...pick<Value>(evt.body, "pretax", "active", "canceled", "frozen", "pretax", "discount", "discountSellerLiability", "discountSellerLiabilityRule", "redemptionRule", "balanceRule", "startDate", "endDate", "metadata", "genericCodeOptions"),
                updatedDate: now
            };
            if (value.startDate) {
                value.startDate = dateInDbPrecision(new Date(value.startDate));
            }
            if (value.endDate) {
                value.endDate = dateInDbPrecision(new Date(value.endDate));
            }

            return {
                body: await updateValue(auth, evt.pathParameters.id, value)
            };
        });

    router.route("/v2/values/{id}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:values:delete:self") && auth.valueId === evt.pathParameters.id) {
                // Badge is signed specifically to delete this Value.
            } else {
                auth.requireScopes("lightrailV2:values:delete");
            }
            return {
                body: await deleteValue(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/values/{id}/stats")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:programs:read");
            return {
                body: await getValuePerformance(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/values/{id}/transactions")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:transactions:list");
            const res = await getTransactions(auth, {
                ...evt.queryStringParameters,
                valueId: evt.pathParameters.id
            }, getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.transactions
            };
        });

    router.route("/v2/values/{id}/changeCode")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:update");
            evt.validateBody(valueChangeCodeSchema);
            checkCodeParameters(evt.body.generateCode, evt.body.code);
            const showCode: boolean = evt.queryStringParameters.showCode === "true";

            const now = nowInDbPrecision();
            let code = evt.body.code;
            if (evt.body.generateCode) {
                code = generateCode(evt.body.generateCode);
            }

            let updateProps: Partial<DbValue> = {
                codeLastFour: null,
                codeEncrypted: null,
                codeHashed: null,
                updatedDate: now
            };

            if (code) {
                const dbCode = await DbCode.getDbCode(code, auth);
                updateProps.codeLastFour = dbCode.lastFour;
                updateProps.codeEncrypted = dbCode.codeEncrypted;
                updateProps.codeHashed = dbCode.codeHashed;
            }

            return {
                body: await updateDbValue(auth, evt.pathParameters.id, updateProps, showCode)
            };
        });
}

export async function getValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams, showCode: boolean = false): Promise<{ values: Value[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();

    let query: QueryBuilder;
    query = knex("Values")
        .select("*")
        .where("Values.userId", "=", auth.userId);

    const paginatedRes = await filterAndPaginateQuery<DbValue>(
        query,
        filterParams,
        {
            properties: {
                id: {
                    type: "string",
                    operators: ["eq", "in"],
                    valueFilter: isSystemId
                },
                programId: {
                    type: "string",
                    operators: ["eq", "in"],
                    valueFilter: isSystemId
                },
                contactId: {
                    type: "string",
                    operators: ["eq"],
                    valueFilter: isSystemId
                },
                issuanceId: {
                    type: "string",
                    operators: ["eq", "in"],
                    valueFilter: isSystemId
                },
                attachedFromValueId: {
                    type: "string",
                    operators: ["eq", "in"],
                    valueFilter: isSystemId
                },
                currency: {
                    type: "string",
                    operators: ["eq", "in"],
                    valueFilter: isSystemId
                },
                balance: {
                    type: "number"
                },
                usesRemaining: {
                    type: "number"
                },
                discount: {
                    type: "boolean"
                },
                isGenericCode: {
                    type: "boolean"
                },
                code: {
                    type: "string",
                    operators: ["eq", "in"],
                    columnName: "codeHashed",
                    valueMap: code => computeCodeLookupHash(code, auth)
                },
                active: {
                    type: "boolean"
                },
                frozen: {
                    type: "boolean"
                },
                canceled: {
                    type: "boolean"
                },
                pretax: {
                    type: "boolean"
                },
                startDate: {
                    type: "Date"
                },
                endDate: {
                    type: "Date"
                },
                createdDate: {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
                updatedDate: {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                }
            }
        },
        pagination
    );

    const values = await Promise.all(paginatedRes.body.map(v => DbValue.toValue(v, showCode)));
    return {
        values: values,
        pagination: paginatedRes.pagination
    };
}

export async function getValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, showCode: boolean = false): Promise<Value> {
    auth.requireIds("userId");

    if (!isSystemId(id)) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
    }

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: auth.userId,
            id: id
        });
    if (res.length === 0) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbValue.toValue(res[0], showCode);
}

export async function valueExists(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<boolean> {
    try {
        const existingValue = await getValue(auth, id);
        if (existingValue) {
            return true;
        }
        throw new Error("This isn't a possible execution path. If existingValue doesn't exist the call will return a 404 error.");
    } catch (err) {
        if ((err as giftbitRoutes.GiftbitRestError).statusCode === 404) {
            return false;
        } else {
            throw err;
        }
    }
}

export async function getValueByCode(auth: giftbitRoutes.jwtauth.AuthorizationBadge, code: string, showCode: boolean = false): Promise<Value> {
    auth.requireIds("userId");

    const codeHashed = await computeCodeLookupHash(code, auth);
    log.debug("getValueByCode codeHashed=", codeHashed);

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: auth.userId,
            codeHashed
        });
    if (res.length === 0) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with code '${formatCodeForLastFourDisplay(code)}' not found.`, "ValueNotFound");
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbValue.toValue(res[0], showCode);
}

export async function getDbValuesByTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, transaction: Transaction): Promise<DbValue[]> {
    const valueIds = transaction.steps
        .filter(step => step.rail === "lightrail")
        .map(step => (step as LightrailTransactionStep).valueId);
    if (!valueIds.length) {
        return [];
    }

    const knex = await getKnexRead();
    const dbValues: DbValue[] = await knex("Values")
        .where({userId: auth.userId})
        .whereIn("id", valueIds);
    return dbValues;
}

export async function updateValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, valueUpdates: Partial<Value>): Promise<Value> {
    auth.requireIds("userId");

    if (!isSystemId(id)) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
    }

    const knex = await getKnexWrite();
    return await knex.transaction(async trx => {
        // Get the master version of the Value and lock it.
        const selectValueRes: DbValue[] = await trx("Values").select()
            .where({
                userId: auth.userId,
                id: id
            })
            .forUpdate();
        if (selectValueRes.length === 0) {
            throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
        }
        if (selectValueRes.length > 1) {
            throw new Error(`Illegal SELECT query.  Returned ${selectValueRes.length} values.`);
        }
        const existingValue = await DbValue.toValue(selectValueRes[0]);
        if (valueUpdates.discountSellerLiabilityRule) {
            existingValue.discountSellerLiability = null;
        } else if (valueUpdates.discountSellerLiability != null) {
            MetricsLogger.legacyDiscountSellerLiabilitySet("valueUpdate", auth);
            existingValue.discountSellerLiabilityRule = null;
        }
        let updatedValue: Value = setValueUpdates(existingValue, valueUpdates);
        updatedValue = setDiscountSellerLiabilityPropertiesForLegacySupport(updatedValue);
        await checkForRestrictedUpdates(auth, existingValue, updatedValue);

        checkValueProperties(updatedValue);

        const dbValue = Value.toDbValueUpdate(auth, valueUpdates);
        const updateRes: number = await trx("Values")
            .where({
                userId: auth.userId,
                id: id
            })
            .update(dbValue);
        if (updateRes === 0) {
            throw new cassava.RestError(404);
        }
        if (updateRes > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${updateRes} values.`);
        }
        MetricsLogger.valueUpdated(valueUpdates, auth);
        return updatedValue;
    });
}

function setValueUpdates(existingValue: Value, valueUpdates: Partial<Value>): Value {
    const updatedValue: Value = {
        ...existingValue,
        ...valueUpdates
    };

    if (valueUpdates.genericCodeOptions && valueUpdates.genericCodeOptions.perContact) {
        updatedValue.genericCodeOptions = {
            perContact: {
                ...(existingValue.genericCodeOptions && existingValue.genericCodeOptions.perContact ? existingValue.genericCodeOptions.perContact : {}),
                ...valueUpdates.genericCodeOptions.perContact
            }
        };
    }

    return updatedValue;
}

async function checkForRestrictedUpdates(auth: giftbitRoutes.jwtauth.AuthorizationBadge, existingValue: Value, updatedValue: Value): Promise<void> {
    if (Value.isGenericCodeWithPropertiesPerContact(existingValue) && !Value.isGenericCodeWithPropertiesPerContact(updatedValue)) {
        throw new giftbitRoutes.GiftbitRestError(422, "A value with genericCodeOptions cannot be updated to no longer have genericCodeOptions.");
    }
}

async function updateDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, value: Partial<DbValue>, showCode: boolean): Promise<Value> {
    auth.requireIds("userId");

    try {
        const knex = await getKnexWrite();
        const res = await knex("Values")
            .where({
                userId: auth.userId,
                id: id
            })
            .update(value);
        if (res === 0) {
            throw new cassava.RestError(404);
        }
        if (res > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
        }
    } catch (err) {
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "uq_Values_codeHashed") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with the given code already exists.`, "ValueCodeExists");
        }
        if (constraint === "fk_Values_Currencies") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${value.currency}' does not exist. See the documentation on creating currencies.`, "CurrencyNotFound");
        }
        throw err;
    }
    return {
        ...await getValue(auth, id, showCode)
    };
}

async function deleteValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<{ success: true }> {
    auth.requireIds("userId");

    if (!isSystemId(id)) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
    }

    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Values")
            .where({
                userId: auth.userId,
                id
            })
            .delete();
        if (res === 0) {
            throw new giftbitRoutes.GiftbitRestError(404, `Value with id '${id}' not found.`, "ValueNotFound");
        }
        if (res > 1) {
            throw new Error(`Illegal DELETE query.  Deleted ${res} values.`);
        }
        return {success: true};
    } catch (err) {
        if (err.code === "ER_ROW_IS_REFERENCED_2") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Value '${id}' is in use.`, "ValueInUse");
        }
        throw err;
    }
}

/**
 * For now this is a secret param only Yervana and Chairish know about.
 */
export async function injectValueStats(auth: giftbitRoutes.jwtauth.AuthorizationBadge, values: Value[]): Promise<void> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res: { valueId: string, balanceChange: number, usesRemainingChange: number }[] = await knex("LightrailTransactionSteps")
        .join("Transactions", {
            "Transactions.userId": "LightrailTransactionSteps.userId",
            "Transactions.id": "LightrailTransactionSteps.transactionId"
        })
        .where({"LightrailTransactionSteps.userId": auth.userId})
        .whereIn("LightrailTransactionSteps.valueId", values.map(value => value.id))
        .where(query =>
            query.where({"Transactions.transactionType": "initialBalance"})
                .orWhere(query =>
                    // `attach` transactions have 2 steps.  The step for the Value being created
                    // (the one we want) has a positive usesRemainingChange.
                    query.where({"Transactions.transactionType": "attach"})
                        .where("LightrailTransactionSteps.usesRemainingChange", ">", 0)
                )
        )
        .select("LightrailTransactionSteps.valueId", "LightrailTransactionSteps.balanceChange", "LightrailTransactionSteps.usesRemainingChange");

    const valueMap: { [id: string]: Value & { stats: { initialBalance: number | null, initialUsesRemaining: number | null } } } = {};
    for (const value of values) {
        (value as any).stats = {
            initialBalance: value.balance != null ? 0 : null,
            initialUsesRemaining: value.usesRemaining != null ? 0 : null
        };
        valueMap[value.id] = value as any;
    }

    for (const row of res) {
        const value = valueMap[row.valueId];
        if (!value) {
            // this shouldn't happen
            continue;
        }
        value.stats.initialBalance = row.balanceChange;
        value.stats.initialUsesRemaining = row.usesRemainingChange;
    }
}

/**
 * This is currently a secret operation only the web app knows about.
 */
export async function getValuePerformance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueId: string): Promise<any> {
    auth.requireIds("userId");
    const value = await getValue(auth, valueId); // checks that the value exists. throws a 404 otherwise.

    const startTime = Date.now();
    const stats = {
        redeemed: {
            balance: 0,
            transactionCount: 0
        },
        checkout: {
            lightrailSpend: 0,
            overspend: 0, // paidStripe + paidInternal + remainder
            transactionCount: 0
        },
        attachedContacts: {
            count: 0
        }
    };

    const knex = await getKnexRead();
    const attachedFromGenericValueStats = await knex("Values")
        .where({
            "userId": auth.userId,
            "attachedFromValueId": valueId
        })
        .count({count: "*"});
    stats.attachedContacts.count += attachedFromGenericValueStats[0].count;

    // unique code
    if (value.contactId) {
        stats.attachedContacts.count += 1;
    }

    /**
     * Note, this query joins from root Transactions involving the valueId to the last Transaction in the chain.
     * This will need to be updated once partial capture becomes a thing since joining to the last Transaction in the chain
     * will no longer give a complete picture regarding what happened.
     */
    let query = knex("Values as V")
        .where({
            "V.userId": auth.userId,
        })
        .andWhere(q => {
            if (attachedFromGenericValueStats[0].count > 0) {
                // stats that are interesting are from the attached values, not the generic code itself
                q.where("V.attachedFromValueId", "=", valueId);
            } else {
                // only pull stats for valueId in question.
                q.where("V.id", "=", valueId);
            }
            return q;
        })
        .join("LightrailTransactionSteps as LTS", {
            "LTS.userId": "V.userId",
            "LTS.valueId": "V.id"
        })
        .join("Transactions as T_ROOT", {
            "T_ROOT.userId": "LTS.userId",
            "T_ROOT.id": "LTS.transactionId"
        })
        .whereIn("T_ROOT.transactionType", ["checkout", "debit"])
        .leftJoin("Transactions as T_LAST", query => {
            query.on("T_ROOT.id", "=", "T_LAST.rootTransactionId")
                .andOn("T_ROOT.userId", "=", "T_LAST.userId")
                .andOn("T_LAST.id", "!=", "T_LAST.rootTransactionId")
                .andOnNull("T_LAST.nextTransactionId");
        })
        .count({transactionCount: "*"})
        .sum({balanceChange: "LTS.balanceChange"})
        .sum({discountLightrail: "T_ROOT.totals_discountLightrail"})
        .sum({paidLightrail: "T_ROOT.totals_paidLightrail"})
        .sum({paidStripe: "T_ROOT.totals_paidStripe"})
        .sum({paidInternal: "T_ROOT.totals_paidInternal"})
        .sum({remainder: "T_ROOT.totals_remainder"})
        .select({rootTransactionType: "T_ROOT.transactionType"})
        .select({finalTransactionType: "T_LAST.transactionType"})
        .groupBy("T_LAST.transactionType")
        .groupBy("T_ROOT.transactionType");

    const results: {
        transactionCount?: number | string; // Knex thinks this might come back as a string. ¯\_(ツ)_/¯
        balanceChange?: string; // For some reason sums come back as strings.
        discountLightrail?: string;
        paidLightrail?: string;
        paidStripe?: string;
        paidInternal?: string;
        remainder?: string;
        rootTransactionType: string; // The transactionType of the root transaction. Restricted to checkout and debit.
        finalTransactionType: string; // A join is done from the root transaction to the last transaction in the chain.
                                      // This is the transactionType of the last transaction in the chain.
                                      // If null, this means the root transaction is the only transaction in the chain.
    }[] = await query;
    for (const row of results) {
        if (row.rootTransactionType === "debit" && (row.finalTransactionType === null || row.finalTransactionType === "capture")) {
            stats.redeemed.balance += -row.balanceChange;
            stats.redeemed.transactionCount += +row.transactionCount;
        } else if (row.rootTransactionType === "checkout" && (row.finalTransactionType === null || row.finalTransactionType === "capture")) {
            stats.redeemed.transactionCount += +row.transactionCount;
            stats.redeemed.balance += -row.balanceChange;
            stats.checkout.lightrailSpend += +row.paidLightrail + +row.discountLightrail;
            stats.checkout.transactionCount += +row.transactionCount;
            stats.checkout.overspend += +row.paidStripe + +row.paidInternal + +row.remainder;
        }
    }

    log.info(`Calculating value stats finished and took ${Date.now() - startTime}ms`);
    return stats;
}

type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type StringBalanceValue = Omit<Value, "balance"> & { balance: string | number };

async function formatValueForCurrencyDisplay(auth: giftbitRoutes.jwtauth.AuthorizationBadge, values: Value[]): Promise<StringBalanceValue[]> {
    const formattedValues: StringBalanceValue[] = [];
    const retrievedCurrencies: { [key: string]: Currency } = {};
    for (const value of values) {
        if (!retrievedCurrencies[value.currency]) {
            retrievedCurrencies[value.currency] = await getCurrency(auth, value.currency);
        }
        formattedValues.push({
            ...value,
            balance: value.balance != null ? formatAmountForCurrencyDisplay(value.balance, retrievedCurrencies[value.currency]) : value.balance
        });
    }
    return formattedValues;
}

const valueSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 64,
            minLength: 1,
            pattern: isSystemId.regexString
        },
        currency: {
            type: "string",
            minLength: 1,
            maxLength: 16
        },
        programId: {
            type: ["string", null],
            maxLength: 64,
            minLength: 1
        },
        balance: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 2147483647
        },
        usesRemaining: {
            type: ["integer", "null"],
            minimum: 0,
            maximum: 2147483647
        },
        code: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 255
        },
        isGenericCode: {
            type: ["boolean", "null"]
        },
        generateCode: {
            title: "Code Generation Params",
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                length: {
                    type: "number"
                },
                charset: {
                    type: "string"
                },
                prefix: {
                    type: "string"
                },
                suffix: {
                    type: "string"
                }
            }
        },
        genericCodeOptions: {
            title: "Generic Code Properties",
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                perContact: {
                    title: "Value Properties Per Contact Params",
                    type: ["object", "null"],
                    additionalProperties: false,
                    properties: {
                        balance: {
                            type: ["integer", "null"],
                            minimum: 0,
                            maximum: 2147483647
                        },
                        usesRemaining: {
                            type: ["integer", "null"],
                            minimum: 0,
                            maximum: 2147483647
                        }
                    }
                }
            }
        },
        contactId: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 64
        },
        active: {
            type: "boolean"
        },
        frozen: {
            type: "boolean"
        },
        pretax: {
            type: "boolean"
        },
        redemptionRule: {
            ...ruleSchema,
            title: "Redemption rule",
        },
        balanceRule: {
            ...ruleSchema,
            title: "Balance rule"
        },
        discount: {
            type: "boolean"
        },
        discountSellerLiabilityRule: {
            ...ruleSchema,
            title: "DiscountSellerLiability rule"
        },
        discountSellerLiability: {
            type: ["number", "null"],
            minimum: 0,
            maximum: 1
        },
        startDate: {
            type: ["string", "null"],
            format: "date-time"
        },
        endDate: {
            type: ["string", "null"],
            format: "date-time"
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["id"],
    dependencies: {
        discountSellerLiability: {
            properties: {
                discountSellerLiabilityRule: {
                    enum: [null, undefined]
                }
            }
        },
        discountSellerLiabilityRule: {
            properties: {
                discountSellerLiability: {
                    enum: [null, undefined]
                }
            }
        }
    }
};

const valueUpdateSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        ...pick(valueSchema.properties, "id", "active", "frozen", "pretax", "redemptionRule", "balanceRule", "discount", "discountSellerLiability", "discountSellerLiabilityRule", "startDate", "endDate", "metadata", "genericCodeOptions"),
        canceled: {
            type: "boolean"
        }
    },
    required: [],
    dependencies: {
        discountSellerLiability: {
            properties: {
                discountSellerLiabilityRule: {
                    enum: [null, undefined]
                }
            }
        },
        discountSellerLiabilityRule: {
            properties: {
                discountSellerLiability: {
                    enum: [null, undefined]
                }
            }
        }
    }
};

const valueChangeCodeSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        ...pick(valueSchema.properties, "code", "generateCode"),
    },
    required: []
};

export interface CreateValueParameters {
    partialValue: Partial<Value>;
    generateCodeParameters: GenerateCodeParameters | null;
    program: Program | null;
}

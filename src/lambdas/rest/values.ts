import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {DbValue, formatCodeForLastFourDisplay, Rule, Value} from "../../model/Value";
import {pick, pickOrDefault} from "../../utils/pick";
import {csvSerializer} from "../../serializers";
import {
    dateInDbPrecision,
    filterAndPaginateQuery,
    getSqlErrorConstraintName,
    nowInDbPrecision
} from "../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {DbTransaction, LightrailDbTransactionStep} from "../../model/Transaction";
import {DbCode} from "../../model/DbCode";
import {generateCode} from "../../utils/codeGenerator";
import {computeCodeLookupHash} from "../../utils/codeCryptoUtils";
import {getProgram} from "./programs";
import {Program} from "../../model/Program";
import * as Knex from "knex";
import {GenerateCodeParameters} from "../../model/GenerateCodeParameters";
import {getTransactions} from "./transactions/transactions";
import {Currency, formatAmountForCurrencyDisplay} from "../../model/Currency";
import {getCurrency} from "./currencies";
import {getRuleFromCache} from "./transactions/getRuleFromCache";
import {MetricsLogger, ValueAttachmentTypes} from "../../utils/metricsLogger";
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
                // For now this is a secret param only Yervana knows about.
                await injectValueStats(auth, res.values);
            }

            let values: Value[] | StringBalanceValue[] = res.values;
            if (evt.queryStringParameters.formatCurrencies === "true") {
                values = await formatValueForCurrencyDisplay(auth, res.values);
            }

            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: values
            };
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
                        program: program,
                        showCode: (evt.queryStringParameters.showCode === "true")
                    },
                    trx);
            });

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
                // For now this is a secret param only Yervana knows about.
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
                ...pick<Value>(evt.body, "pretax", "active", "canceled", "frozen", "pretax", "discount", "discountSellerLiability", "redemptionRule", "balanceRule", "startDate", "endDate", "metadata"),
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
            checkCodeParameters(evt.body.generateCode, evt.body.code, evt.body.isGenericCode);

            const now = nowInDbPrecision();
            let code = evt.body.code;
            let isGenericCode = evt.body.isGenericCode ? evt.body.isGenericCode : false;
            if (evt.body.generateCode) {
                code = generateCode(evt.body.generateCode);
                isGenericCode = false;
            }

            const dbCode = await DbCode.getDbCode(code, auth);
            let partialValue: Partial<DbValue> = {
                codeLastFour: dbCode.lastFour,
                codeEncrypted: dbCode.codeEncrypted,
                codeHashed: dbCode.codeHashed,
                isGenericCode: isGenericCode,
                updatedDate: now
            };
            return {
                body: await updateDbValue(auth, evt.pathParameters.id, partialValue)
            };
        });
}

export async function getValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams, showCode: boolean = false): Promise<{ values: Value[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();

    let query = knex("Values")
        .select("Values.*")
        .where("Values.userId", "=", auth.userId);
    const contactId = filterParams["contactId"] || filterParams["contactId.eq"];
    if (contactId) {
        query.leftJoin("ContactValues", {
            "Values.id": "ContactValues.valueId",
            "Values.userId": "ContactValues.userId"
        });
        query.andWhere(q => {
                q.where("Values.contactId", "=", contactId);
                q.orWhere("ContactValues.contactId", "=", contactId);
                return q;
            }
        );
    }

    // Manually handle code, code.eq and code.in because computeCodeLookupHash must be done async.
    if (filterParams.code) {
        query = query.where({codeHashed: await computeCodeLookupHash(filterParams.code, auth)});
    } else if (filterParams["code.eq"]) {
        query = query.where({codeHashed: await computeCodeLookupHash(filterParams["code.eq"], auth)});
    } else if (filterParams["code.in"]) {
        query = query.whereIn("codeHashed", await Promise.all(filterParams["code.in"].split(",").map(v => computeCodeLookupHash(v, auth))));
    }

    const paginatedRes = await filterAndPaginateQuery<DbValue>(
        query,
        filterParams,
        {
            properties: {
                id: {
                    type: "string",
                    operators: ["eq", "in"]
                },
                programId: {
                    type: "string",
                    operators: ["eq", "in"]
                },
                issuanceId: {
                    type: "string",
                    operators: ["eq", "in"]
                },
                currency: {
                    type: "string",
                    operators: ["eq", "in"]
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
                    type: "Date"
                },
                updatedDate: {
                    type: "Date"
                }
            },
            tableName: "Values"
        },
        pagination
    );

    const values = await Promise.all(paginatedRes.body.map(v => DbValue.toValue(v, showCode)));
    return {
        values: values,
        pagination: paginatedRes.pagination
    };
}

export async function createValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, params: CreateValueParameters, trx: Knex.Transaction, retryCount: number = 0): Promise<Value> {
    auth.requireIds("userId", "teamMemberId");
    let value: Value = initializeValue(auth, params.partialValue, params.program, params.generateCodeParameters);
    log.info(`Create Value requested for user: ${auth.userId}. Value`, Value.toStringSanitized(value));

    log.info(`Checking properties for ${value.id}.`);
    checkValueProperties(value, params.program);

    value.startDate = value.startDate ? dateInDbPrecision(new Date(value.startDate)) : null;
    value.endDate = value.endDate ? dateInDbPrecision(new Date(value.endDate)) : null;

    const dbValue = await Value.toDbValue(auth, value);

    try {
        await trx.into("Values")
            .insert(dbValue);
        if (value.balance || value.usesRemaining) {
            if (value.balance < 0) {
                throw new Error("balance cannot be negative");
            }
            if (value.usesRemaining < 0) {
                throw new Error("usesRemaining cannot be negative");
            }

            const transactionId = value.id;
            const initialBalanceTransaction: DbTransaction = {
                userId: auth.userId,
                id: transactionId,
                transactionType: "initialBalance",
                currency: value.currency,
                totals_subtotal: null,
                totals_tax: null,
                totals_discountLightrail: null,
                totals_paidLightrail: null,
                totals_paidStripe: null,
                totals_paidInternal: null,
                totals_remainder: null,
                totals_marketplace_sellerGross: null,
                totals_marketplace_sellerDiscount: null,
                totals_marketplace_sellerNet: null,
                lineItems: null,
                paymentSources: null,
                pendingVoidDate: null,
                metadata: null,
                rootTransactionId: transactionId,
                nextTransactionId: null,
                createdDate: value.createdDate,
                tax: null,
                createdBy: auth.teamMemberId,
            };
            const initialBalanceTransactionStep: LightrailDbTransactionStep = {
                userId: auth.userId,
                id: `${value.id}-0`,
                transactionId: transactionId,
                valueId: value.id,
                balanceBefore: value.balance != null ? 0 : null,
                balanceAfter: value.balance,
                balanceChange: value.balance,
                usesRemainingBefore: value.usesRemaining != null ? 0 : null,
                usesRemainingAfter: value.usesRemaining,
                usesRemainingChange: value.usesRemaining
            };
            await trx.into("Transactions").insert(initialBalanceTransaction);
            await trx.into("LightrailTransactionSteps").insert(initialBalanceTransactionStep);
        }

        if (value.contactId) {
            MetricsLogger.valueAttachment(ValueAttachmentTypes.OnCreate, auth);
        }

        return DbValue.toValue(dbValue, params.showCode);
    } catch (err) {
        log.debug(err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with id '${value.id}' already exists.`, "ValueIdExists");
        }
        if (constraint === "uq_Values_codeHashed") {
            if (params.generateCodeParameters && retryCount < 2 /* Retrying twice is an arbitrary number. This may need to be increased if we're still seeing regular failures. Unless users are using their own character set there are around 1 billion possible codes. It seems unlikely for 3+ retry failures even if users have millions of codes. */) {
                log.info(`Retrying creating the Value because there was a code uniqueness constraint failure for a generated code. Retry number: ${retryCount}. ValueId: ${params.partialValue.id}.`);
                return createValue(auth, params, trx, retryCount + 1);
            } else {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Value with the given code already exists.`, "ValueCodeExists");
            }
        }
        if (constraint === "fk_Values_Currencies") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${value.currency}' does not exist. See the documentation on creating currencies.`, "CurrencyNotFound");
        }
        if (constraint === "fk_Values_Contacts") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact '${value.contactId}' does not exist.`, "ContactNotFound");
        }
        throw err;
    }
}

export async function getValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, showCode: boolean = false): Promise<Value> {
    auth.requireIds("userId");

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

export async function updateValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, valueUpdates: Partial<Value>): Promise<Value> {
    auth.requireIds("userId");

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
        const updatedValue = {
            ...existingValue,
            ...valueUpdates
        };

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

        return updatedValue;
    });
}

async function updateDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, value: Partial<DbValue>): Promise<Value> {
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
            throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
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
        ...await getValue(auth, id)
    };
}

async function deleteValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<{ success: true }> {
    auth.requireIds("userId");

    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Values")
            .where({
                userId: auth.userId,
                id
            })
            .delete();
        if (res === 0) {
            throw new cassava.RestError(404);
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
 * This is currently a secret operation only Yervana knows about.
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
    /**
     * Note, this query joins from root Transactions involving the valueId to the last Transaction in the chain.
     * This will need to be updated once partial capture becomes a thing since joining to the last Transaction in the chain
     * will no longer give a complete picture regarding what happened.
     */
    let query = knex("LightrailTransactionSteps as LTS")
        .where({
            "LTS.userId": auth.userId,
            "LTS.valueId": valueId,
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
        transactionCount: number;
        balanceChange: string; // For some reason sums come back as strings.
        discountLightrail: string;
        paidLightrail: string;
        paidStripe: string;
        paidInternal: string;
        remainder: string;
        rootTransactionType: string; // The transactionType of the root transaction. Restricted to checkout and debit.
        finalTransactionType: string; // A join is done from the root transaction to the last transaction in the chain.
                                      // This is the transactionType of the last transaction in the chain.
                                      // If null, this means the root transaction is the only transaction in the chain.
    }[] = await query;

    for (const row of results) {
        if (row.rootTransactionType === "debit" && (row.finalTransactionType === null || row.finalTransactionType === "capture")) {
            stats.redeemed.balance += -row.balanceChange;
            stats.redeemed.transactionCount += row.transactionCount;
        } else if (row.rootTransactionType === "checkout" && (row.finalTransactionType === null || row.finalTransactionType === "capture")) {
            stats.redeemed.transactionCount += row.transactionCount;
            stats.redeemed.balance += -row.balanceChange;
            stats.checkout.lightrailSpend += +row.paidLightrail + +row.discountLightrail;
            stats.checkout.transactionCount += row.transactionCount;
            stats.checkout.overspend += +row.paidStripe + +row.paidInternal + +row.remainder;
        }
    }

    const attachedStats = await knex("ContactValues")
        .where({
            "userId": auth.userId,
            "valueId": valueId
        })
        .count({count: "*"});
    stats.attachedContacts.count = attachedStats[0].count;

    if (value.contactId) {
        stats.attachedContacts.count += 1;
    }

    log.info(`Calculating value stats finished and took ${Date.now() - startTime}ms`);
    return stats;
}

function initializeValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, partialValue: Partial<Value>, program: Program = null, generateCodeParameters: GenerateCodeParameters = null): Value {
    const now = nowInDbPrecision();

    console.log((partialValue.genericCodeProperties ? "b" : "c"));
    console.log((partialValue.genericCodeProperties != null ? "b" : "c"));
    console.log((partialValue.genericCodeProperties.valuePropertiesPerContact.balance != null ? "b" : "c"));
    console.log((partialValue.genericCodeProperties != null && partialValue.genericCodeProperties.valuePropertiesPerContact.balance != null ? "b" : "c"));
    console.log("partialValue: " + JSON.stringify(partialValue, null, 4));
    let value: Value = pickOrDefault(partialValue, {
        id: null,
        currency: program ? program.currency : null,
        balance: partialValue.balanceRule || (program && program.balanceRule) ? null : 0,
        usesRemaining: null,
        programId: program ? program.id : null,
        issuanceId: null,
        code: null,
        isGenericCode: false,
        genericCodeProperties: partialValue.genericCodeProperties ? partialValue.genericCodeProperties : undefined,
        attachedFromGenericValueId: null,
        contactId: null,
        pretax: program ? program.pretax : false,
        active: program ? program.active : true,
        canceled: false,
        frozen: false,
        discount: program ? program.discount : false,
        discountSellerLiability: program ? program.discountSellerLiability : null,
        redemptionRule: program ? program.redemptionRule : null,
        balanceRule: program ? program.balanceRule : null,
        startDate: program ? program.startDate : null,
        endDate: program ? program.endDate : null,
        metadata: {},
        createdDate: now,
        updatedDate: now,
        updatedContactIdDate: partialValue.contactId ? now : null,
        createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,
    });

    if (partialValue.genericCodeProperties != null && partialValue.genericCodeProperties.valuePropertiesPerContact.balance != null) {
        value.balance = partialValue.balance; // set to whatever the user set it to.
    }

    value.metadata = {...(program && program.metadata ? program.metadata : {}), ...value.metadata};

    if (generateCodeParameters) {
        checkCodeParameters(generateCodeParameters, value.code, value.isGenericCode);
        value.code = generateCodeParameters ? generateCode(generateCodeParameters) : value.code;
    }
    if (value.code && value.isGenericCode == null) {
        value.isGenericCode = false;
    }
    return value;
}

function checkValueProperties(value: Value, program: Program = null): void {
    if (program) {
        checkProgramConstraints(value, program);
    }

    if (value.balance != null && value.balanceRule) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a balance and balanceRule.`);
    }
    console.log("checkValueProperties. Value: " + JSON.stringify(value, null, 4));
    if (value.balance == null && value.balanceRule == null && (value.genericCodeProperties && value.genericCodeProperties.valuePropertiesPerContact.balance == null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value must have a balanceRule, a balance, or a genericCodeProperties.valuePropertiesPerContact.balance.`);
    }
    if (value.discountSellerLiability !== null && !value.discount) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have discountSellerLiability if it is not a discount.`);
    }
    if (value.contactId && value.isGenericCode) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "A Value with isGenericCode=true cannot have contactId set.");
    }
    if (value.endDate && value.startDate > value.endDate) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property startDate cannot exceed endDate.");
    }
    if (!value.currency) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property currency cannot be null. Please provide a currency or a programId.");
    }

    checkRulesSyntax(value, "Value");
}

export function checkRulesSyntax(holder: { redemptionRule?: Rule, balanceRule?: Rule }, holderType: "Value" | "Program"): void {
    if (holder.balanceRule) {
        const rule = getRuleFromCache(holder.balanceRule.rule);
        if (rule.compileError) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `${holderType} balanceRule has a syntax error.`, {
                messageCode: "BalanceRuleSyntaxError",
                syntaxErrorMessage: rule.compileError.msg,
                row: rule.compileError.row,
                column: rule.compileError.column
            });
        }
    }
    if (holder.redemptionRule) {
        const rule = getRuleFromCache(holder.redemptionRule.rule);
        if (rule.compileError) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `${holderType} redemptionRule has a syntax error.`, {
                messageCode: "RedemptionRuleSyntaxError",
                syntaxErrorMessage: rule.compileError.msg,
                row: rule.compileError.row,
                column: rule.compileError.column
            });
        }
    }
}

function checkProgramConstraints(value: Value, program: Program): void {
    if (program.fixedInitialBalances && (program.fixedInitialBalances.indexOf(value.balance) === -1 || value.balance === null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is outside fixedInitialBalances defined by Program ${program.fixedInitialBalances}.`);
    }
    if (program.minInitialBalance !== null && (value.balance < program.minInitialBalance || value.balance === null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is less than minInitialBalance ${program.minInitialBalance}.`);
    }
    if (program.maxInitialBalance !== null && (value.balance > program.maxInitialBalance || value.balance === null)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is greater than maxInitialBalance ${program.maxInitialBalance}.`);
    }

    if (program.fixedInitialUsesRemaining && (program.fixedInitialUsesRemaining.indexOf(value.usesRemaining) === -1 || !value.usesRemaining)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's usesRemaining ${value.usesRemaining} outside fixedInitialUsesRemaining defined by Program ${program.fixedInitialUsesRemaining}.`);
    }

    if (program.currency !== value.currency) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's currency ${value.currency} cannot differ from currency of Program ${program.currency}.`);
    }
}

export function checkCodeParameters(generateCode: GenerateCodeParameters, code: string, isGenericCode: boolean): void {
    if (generateCode && (code || isGenericCode)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Parameter generateCode is not allowed with parameters code or isGenericCode:true.`);
    }
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
            pattern: "^[ -~]*$"
        },
        currency: {
            type: "string",
            minLength: 1,
            maxLength: 16
        },
        programId: {
            type: "string",
            maxLength: 64,
            minLength: 1
        },
        balance: {
            type: ["integer", "null"],
            minimum: 0
        },
        usesRemaining: {
            type: ["integer", "null"]
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
        genericCodeProperties: {
            title: "Generic Code Properties",
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
                valuePropertiesPerContact: {
                    title: "Value Properties Per Contact Params",
                    type: ["object", "null"],
                    additionalProperties: false,
                    properties: {
                        balance: {
                            type: ["integer", "null"]
                        },
                        usesRemaining: {
                            type: ["integer", "null"]
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
            oneOf: [
                {
                    type: "null"
                },
                {
                    title: "Redemption rule",
                    type: "object",
                    properties: {
                        rule: {
                            type: "string"
                        },
                        explanation: {
                            type: "string"
                        }
                    }
                }
            ]
        },
        balanceRule: {
            oneOf: [
                {
                    type: "null"
                },
                {
                    title: "Balance rule",
                    type: "object",
                    properties: {
                        rule: {
                            type: "string"
                        },
                        explanation: {
                            type: "string"
                        }
                    }
                }
            ]
        },
        discount: {
            type: "boolean"
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
                discount: {
                    enum: [true]
                }
            }
        }
    }
};

const valueUpdateSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        ...pick(valueSchema.properties, "id", "active", "frozen", "pretax", "redemptionRule", "balanceRule", "discount", "discountSellerLiability", "startDate", "endDate", "metadata"),
        canceled: {
            type: "boolean"
        }
    },
    required: []
};

const valueChangeCodeSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        ...pick(valueSchema.properties, "code", "isGenericCode", "generateCode"),
    },
    required: []
};

export interface CreateValueParameters {
    partialValue: Partial<Value>;
    generateCodeParameters: GenerateCodeParameters | null;
    program: Program | null;
    showCode: boolean;
}

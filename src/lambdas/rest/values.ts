import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {DbValue, Value} from "../../model/Value";
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
import {codeLastFour, DbCode} from "../../model/DbCode";
import {generateCode} from "../../services/codeGenerator";
import {computeCodeLookupHash} from "../../utils/codeCryptoUtils";
import {getProgram} from "./programs";
import {Program} from "../../model/Program";
import * as Knex from "knex";
import {GenerateCodeParameters} from "../../model/GenerateCodeParameters";
import {getTransactions} from "./transactions/transactions";
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

            // todo - remove this check once uses is no longer supported.
            if (evt.pathParameters.uses) {
                evt.pathParameters.usesRemaining = evt.pathParameters.uses;
                delete evt.pathParameters.uses
            }

            const showCode: boolean = (evt.queryStringParameters.showCode === "true");
            const res = await getValues(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt), showCode);

            if (evt.queryStringParameters.stats === "true") {
                // For now this is a secret param only Yervana knows about.
                await injectValueStats(auth, res.values);
            }

            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.values
            };
        });

    router.route("/v2/values")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId"); // todo require tmi again when all users have upgraded to new libraries to generate tokens properly
            // auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:values:create");

            // todo - remove these checks
            if (evt.body.valueRule && !evt.body.balanceRule) {
                evt.body.balanceRule = evt.body.valueRule;
                delete evt.body.valueRule;
            }
            if (evt.body.uses != null && evt.body.usesRemaining == null) {
                evt.body.usesRemaining = evt.body.uses;
                delete evt.body.uses;
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

    router.route("/v2/values")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:list", "lightrailV2:values:update");
            throw new giftbitRoutes.GiftbitRestError(500, "Not implemented");   // TODO
        });

    router.route("/v2/values/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:values:read");

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
            auth.requireScopes("lightrailV2:values:update");
            // todo - remove this when valueRule is no longer supported
            if (evt.body.valueRule && !evt.body.balanceRule) {
                evt.body.balanceRule = evt.body.valueRule;
                delete evt.body.valueRule;
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
            auth.requireScopes("lightrailV2:values:delete");
            return {
                body: await deleteValue(auth, evt.pathParameters.id)
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

            const dbCode = new DbCode(code, isGenericCode, auth);
            let partialValue: Partial<DbValue> = {
                code: dbCode.lastFour,
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

    const paginatedRes = await filterAndPaginateQuery<DbValue>(
        knex("Values")
            .where({
                userId: auth.userId
            }),
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
                code: {
                    type: "string",
                    columnName: "codeHashed",
                    valueMap: value => computeCodeLookupHash(value, auth),
                    operators: ["eq", "in"]
                },
                currency: {
                    type: "string",
                    operators: ["eq", "in"]
                },
                contactId: {
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
            }
        },
        pagination
    );
    return {
        values: paginatedRes.body.map(function (v) {
            return DbValue.toValue(v, showCode);
        }),
        pagination: paginatedRes.pagination
    };
}

export async function createValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, params: CreateValueParameters, trx: Knex.Transaction): Promise<Value> {
    auth.requireIds("userId"); // todo require tmi again when all users have upgraded to new libraries to generate tokens properly
    // auth.requireIds("userId", "teamMemberId");
    let value: Value = initializeValue(auth, params.partialValue, params.program, params.generateCodeParameters);
    log.info(`Create Value requested for user: ${auth.userId}. Value ${Value.toStringSanitized(value)}.`);

    log.info(`Checking properties for ${value.id}.`);
    checkValueProperties(value, params.program);

    value.startDate = value.startDate ? dateInDbPrecision(new Date(value.startDate)) : null;
    value.endDate = value.endDate ? dateInDbPrecision(new Date(value.endDate)) : null;

    const dbValue = Value.toDbValue(auth, value);
    log.info(`Creating Value ${Value.toStringSanitized(value)}.`);

    try {
        await trx.into("Values")
            .insert(dbValue);
        if (value.balance) {
            if (value.balance < 0) {
                throw new Error("balance cannot be negative");
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
                metadata: null,
                createdDate: value.createdDate,
                tax: null,
                createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,
            };
            const initialBalanceTransactionStep: LightrailDbTransactionStep = {
                userId: auth.userId,
                id: `${value.id}-0`,
                transactionId: transactionId,
                valueId: value.id,
                balanceBefore: 0,
                balanceAfter: value.balance,
                balanceChange: value.balance
            };
            await trx.into("Transactions").insert(initialBalanceTransaction);
            await trx.into("LightrailTransactionSteps").insert(initialBalanceTransactionStep);
        }
        return DbValue.toValue(dbValue, params.showCode);
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

    const codeHashed = computeCodeLookupHash(code, auth);
    log.debug("getValueByCode codeHashed=", codeHashed);

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: auth.userId,
            codeHashed
        });
    if (res.length === 0) {
        throw new giftbitRoutes.GiftbitRestError(404, `Value with code '${codeLastFour(code)}' not found.`, "ValueNotFound");
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbValue.toValue(res[0], showCode);
}

async function updateValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, value: Partial<Value>): Promise<Value> {
    auth.requireIds("userId");

    const dbValue = Value.toDbValueUpdate(auth, value);
    const knex = await getKnexWrite();
    const res: number = await knex("Values")
        .where({
            userId: auth.userId,
            id: id
        })
        .update(dbValue);
    if (res === 0) {
        throw new cassava.RestError(404);
    }
    if (res > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
    }
    return {
        ...await getValue(auth, id)
    };
}

async function updateDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, value: Partial<DbValue>): Promise<Value> {
    auth.requireIds("userId");

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
    const res: { valueId: string, balanceChange: number }[] = await knex("LightrailTransactionSteps")
        .join("Transactions", {
            "Transactions.userId": "LightrailTransactionSteps.userId",
            "Transactions.id": "LightrailTransactionSteps.transactionId"
        })
        .where({
            "LightrailTransactionSteps.userId": auth.userId,
            "Transactions.transactionType": "initialBalance"
        })
        .whereIn("LightrailTransactionSteps.valueId", values.map(value => value.id))
        .select("LightrailTransactionSteps.valueId", "LightrailTransactionSteps.balanceChange");

    const valueMap: { [id: string]: Value & { stats: { initialBalance: number } } } = {};
    for (const value of values) {
        (value as any).stats = {
            initialBalance: 0
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
    }
}

function initializeValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, partialValue: Partial<Value>, program: Program = null, generateCodeParameters: GenerateCodeParameters = null): Value {
    const now = nowInDbPrecision();
    let value: Value = {
        id: null,
        balance: partialValue.balanceRule && !partialValue.balance ? null : 0,
        uses: null, // todo - remove
        usesRemaining: null,
        code: null,
        issuanceId: null,
        isGenericCode: null,
        contactId: null,
        canceled: false,
        frozen: false,
        metadata: {},
        createdDate: now,
        updatedDate: now,
        updatedContactIdDate: partialValue.contactId ? now : null,
        createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,
        ...partialValue,
        ...pickOrDefault(partialValue, {
            currency: program ? program.currency : null,
            programId: program ? program.id : null,
            pretax: program ? program.pretax : false,
            active: program ? program.active : true,
            redemptionRule: program ? program.redemptionRule : null,
            valueRule: program ? program.balanceRule : null, // todo - remove
            balanceRule: program ? program.balanceRule : null,
            discount: program ? program.discount : false,
            discountSellerLiability: program ? program.discountSellerLiability : null,
            startDate: program ? program.startDate : null,
            endDate: program ? program.endDate : null
        })
    };
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

    if (value.balance && value.balanceRule) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a balance and valueRule.`);
    }
    if (value.discountSellerLiability !== null && !value.discount) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have discountSellerLiability if it is not a discount.`);
    }
    if (value.contactId && value.isGenericCode) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "A Value with isGenericCode=true cannot have contactId set.");
    }
    if (value.startDate > value.endDate) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property startDate cannot exceed endDate.");
    }
    if (!value.currency) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Property currency cannot be null. Please provide a currency or a programId.");
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

const valueSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 32,
            minLength: 1
        },
        currency: {
            type: "string",
            minLength: 1,
            maxLength: 16
        },
        programId: {
            type: "string",
            maxLength: 32,
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
        contactId: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 32
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

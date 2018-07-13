import * as cassava from "cassava";
import {RouterEvent} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import * as log from "loglevel";
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

export function installValuesRest(router: cassava.Router): void {
    router.route("/v2/values")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const showCode: boolean = (evt.queryStringParameters.showCode === "true");
            const res = await getValues(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt), showCode);
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.values
            };
        });

    router.route("/v2/values")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueSchema);
            checkCodeParameters(evt);
            let program: Program = null;
            if (evt.body.programId) {
                try {
                    program = await getProgram(auth, evt.body.programId);
                } catch (err) {
                    if (err instanceof cassava.RestError && err.statusCode === 404) {
                        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `No Program found for id ${evt.body.programId}.`);
                    } else {
                        throw err;
                    }
                }
            }

            const now = nowInDbPrecision();
            const value: Value = {
                ...pickOrDefault(evt.body, {
                    id: "",
                    currency: program ? program.currency : "",
                    balance: 0,
                    uses: null,
                    programId: program ? program.id : null,
                    code: evt.body.generateCode ? generateCode(evt.body.generateCode) : null,
                    isGenericCode: evt.body.generateCode ? false : null,
                    contactId: null,
                    pretax: program ? program.pretax : false,
                    active: program ? program.active : true,
                    frozen: false,
                    redemptionRule: program ? program.redemptionRule : null,
                    valueRule: program ? program.valueRule : null,
                    discount: program ? program.discount : false,
                    discountSellerLiability: program ? program.discountSellerLiability : null,
                    startDate: program ? program.startDate : null,
                    endDate: program ? program.endDate : null,
                    metadata: null
                }),
                canceled: false,
                createdDate: now,
                updatedDate: now
            };

            if (value.balance && value.valueRule) {
                throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have both a balance and valueRule.`);
            }
            if (value.discountSellerLiability !== null && !value.discount) {
                throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Value can't have discountSellerLiability if it is not a discount.`);
            }
            if (program) {
                checkProgramConstraints(value, program);
            }
            value.startDate = value.startDate ? dateInDbPrecision(new Date(value.startDate)) : null;
            value.endDate = value.endDate ? dateInDbPrecision(new Date(value.endDate)) : null;

            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createValue(auth, value)
            };
        });

    router.route("/v2/values")
        .method("PATCH")
        .handler(async evt => {
            throw new giftbitRoutes.GiftbitRestError(500, "Not implemented");   // TODO
        });

    router.route("/v2/values/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            const showCode: boolean = (evt.queryStringParameters.showCode === "true");
            return {
                body: await getValue(auth, evt.pathParameters.id, showCode)
            };
        });

    router.route("/v2/values/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueUpdateSchema);

            if (evt.body.id && evt.body.id !== evt.pathParameters.id) {
                throw new giftbitRoutes.GiftbitRestError(422, `The body id '${evt.body.id}' does not match the path id '${evt.pathParameters.id}'.  The id cannot be updated.`);
            }

            const now = nowInDbPrecision();
            const value = {
                ...pick<Value>(evt.body, "contactId", "pretax", "active", "canceled", "frozen", "pretax", "discount", "discountSellerLiability", "redemptionRule", "valueRule", "startDate", "endDate", "metadata"),
                updatedDate: now
            };
            return {
                body: await updateValue(auth, evt.pathParameters.id, value)
            };
        });

    router.route("/v2/values/{id}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteValue(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/values/{id}/changeCode")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueChangeCodeSchema);
            checkCodeParameters(evt);

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
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const paginatedRes = await filterAndPaginateQuery<DbValue>(
        knex("Values")
            .where({
                userId: auth.giftbitUserId
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
                uses: {
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
                preTax: {
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

async function createValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, value: Value): Promise<Value> {
    auth.requireIds("giftbitUserId");

    if (value.contactId && value.isGenericCode) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "A Value with isGenericCode=true cannot have contactId set.");
    }

    try {
        const knex = await getKnexWrite();

        await knex.transaction(async trx => {
            const dbValue = Value.toDbValue(auth, value);
            log.debug("createValue id=", dbValue.id);

            await trx.into("Values")
                .insert(dbValue);
            if (value.balance) {
                if (value.balance < 0) {
                    throw new Error("balance cannot be negative");
                }

                const transactionId = value.id;
                const initialBalanceTransaction: DbTransaction = {
                    userId: auth.giftbitUserId,
                    id: transactionId,
                    transactionType: "credit",
                    currency: value.currency,
                    totals: null,
                    lineItems: null,
                    paymentSources: null,
                    metadata: null,
                    createdDate: value.createdDate
                };
                const initialBalanceTransactionStep: LightrailDbTransactionStep = {
                    userId: auth.giftbitUserId,
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
        });
        if (value.code && !value.isGenericCode) {
            log.debug("obfuscating secure code from response");
            value.code = codeLastFour(value.code);
        }
        return value;
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
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: auth.giftbitUserId,
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
    auth.requireIds("giftbitUserId");

    const codeHashed = computeCodeLookupHash(code, auth);
    log.debug("getValueByCode codeHashed=", codeHashed);

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: auth.giftbitUserId,
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
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res: number = await knex("Values")
        .where({
            userId: auth.giftbitUserId,
            id: id
        })
        .update(Value.toDbValueUpdate(auth, value));
    if (res === 0) {
        throw new cassava.RestError(404);
    }
    if (res > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res} values.`);
    }
    return {
        ...await getValue(auth, id),
        ...value
    };
}

async function updateDbValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, value: Partial<DbValue>): Promise<Value> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("Values")
        .where({
            userId: auth.giftbitUserId,
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
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Values")
            .where({
                userId: auth.giftbitUserId,
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

function checkProgramConstraints(value: Value, program: Program): void {
    if (program.fixedInitialBalances && (program.fixedInitialBalances.indexOf(value.balance) === -1 || !value.balance)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} outside initial values defined by Program ${program.fixedInitialBalances}.`);
    }
    if (program.minInitialBalance && (value.balance < program.minInitialBalance || !value.balance)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is less than minInitialBalance ${program.minInitialBalance}.`);
    }
    if (program.maxInitialBalance && (value.balance > program.maxInitialBalance || !value.balance)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's balance ${value.balance} is less than minInitialBalance ${program.minInitialBalance}.`);
    }

    if (program.fixedInitialUses && (program.fixedInitialUses.indexOf(value.uses) === -1 || !value.uses)) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's uses ${value.uses} outside initial values defined by Program ${program.fixedInitialUses}.`);
    }

    if (program.currency !== value.currency) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Value's currency ${value.currency} cannot differ from currency of Program ${program.currency}.`);
    }
}

function checkCodeParameters(evt: RouterEvent): void {
    if (evt.body.generateCode && (evt.body.code || evt.body.isGenericCode)) {
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
        uses: {
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
        valueRule: {
            oneOf: [
                {
                    type: "null"
                },
                {
                    title: "Value rule",
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
        ...pick(valueSchema.properties, "id", "active", "frozen", "pretax", "redemptionRule", "valueRule", "discount", "discountSellerLiability", "startDate", "endDate", "metadata"),
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

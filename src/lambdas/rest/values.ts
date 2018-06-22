import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {codeLastFour, DbValue, Value} from "../../model/Value";
import {pick, pickOrDefault} from "../../pick";
import {csvSerializer} from "../../serializers";
import {filterAndPaginateQuery, getSqlErrorConstraintName, nowInDbPrecision} from "../../dbUtils";
import {getKnexRead, getKnexWrite} from "../../dbUtils/connection";

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
            const showCode: boolean = (evt.queryStringParameters.showCode === 'true');
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

            const now = nowInDbPrecision();
            const value: Value = {
                ...pickOrDefault(evt.body, {
                    id: "",
                    currency: "",
                    balance: 0,
                    uses: null,
                    programId: null,
                    code: evt.body.genericCode ? evt.body.genericCode : null,
                    contactId: null,
                    pretax: false,
                    active: true,
                    frozen: false,
                    redemptionRule: null,
                    valueRule: null,
                    discount: false,
                    startDate: null,
                    endDate: null,
                    metadata: null
                }),
                canceled: false,
                createdDate: now,
                updatedDate: now
            };
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createValue(auth, value, !!evt.body.genericCode)
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

            const showCode: boolean = (evt.queryStringParameters.showCode === 'true');
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
                ...pick<Value>(evt.body, "contactId", "pretax", "active", "canceled", "frozen", "pretax", "redemptionRule", "valueRule", "startDate", "endDate", "metadata"),
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
            throw new giftbitRoutes.GiftbitRestError(500, "Not implemented");   // TODO
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
            return DbValue.toValue(v, showCode)
        }),
        pagination: paginatedRes.pagination
    };
}

async function createValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, value: Value, genericCode: boolean): Promise<Value> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();

        await knex.transaction(async trx => {
            await trx.into("Values")
                .insert(Value.toDbValue(auth, value, genericCode));
            if (value.balance) {
                // TODO insert initialValue Transaction and LightrailTransactionStep
            }
        });
        if (value.code && !genericCode) {
            // obfuscate secure code from response.
            value.code = codeLastFour(value.code);
        }
        return value;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Values with id '${value.id}' already exists.`);
        }
        if (err.code === "ER_NO_REFERENCED_ROW_2") {
            const constraint = getSqlErrorConstraintName(err);
            if (constraint === "fk_Values_Currencies") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${value.currency}' does not exist.  See the documentation on creating currencies.`, "CurrencyNotFound");
            }
            if (constraint === "fk_Values_Contacts") {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact '${value.contactId}' does not exist.`, "ContactNotFound");
            }
        }
        throw err;
    }
}

async function getValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, showCode: boolean = false): Promise<Value> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValue[] = await knex("Values")
        .select()
        .where({
            userId: auth.giftbitUserId,
            id: id
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbValue.toValue(res[0], showCode);
}

async function updateValue(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, value: Partial<Value>): Promise<Value> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("Values")
        .where({
            userId: auth.giftbitUserId,
            id: id
        })
        .update(Value.toDbValueUpdate(auth, value));
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
    }
    return {
        ...await getValue(auth, id),
        ...value
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

const valueSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    oneOf: [
        {
            required: ["genericCode"],
            title: "genericCode"
        },
        {
            required: ["code"],
            title: "code"
        },
        {
            not: {
                anyOf: [
                    {
                        required: ["genericCode"]
                    },
                    {
                        required: ["code"]
                    }
                ],
            },
            title: "neither genericCode or code"
        }
    ],
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
        balance: {
            type: ["number", "null"]
        },
        uses: {
            type: ["number", "null"]
        },
        code: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 255
        },
        genericCode: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 255
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
    required: ["id", "currency"]
};

const valueUpdateSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        ...pick(valueSchema.properties, "id", "contactId", "active", "frozen", "pretax", "redemptionRule", "valueRule", "startDate", "endDate", "metadata"),
        canceled: {
            type: "boolean"
        }
    },
    required: []
};

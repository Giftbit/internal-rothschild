import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {Program} from "../../model/Program";
import {csvSerializer} from "../../utils/serializers";
import {pick, pickNotNull, pickOrDefault} from "../../utils/pick";
import {dateInDbPrecision, filterAndPaginateQuery, nowInDbPrecision} from "../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {DbIssuance, Issuance} from "../../model/Issuance";
import {getProgram} from "./programs";
import {Value} from "../../model/Value";
import {CodeParameters} from "../../model/CodeParameters";
import {createValue} from "./values/createValue";
import log = require("loglevel");

export function installIssuancesRest(router: cassava.Router): void {
    router.route("/v2/programs/{programId}/issuances")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:issuances:list");

            const res = await getIssuances(auth, evt.pathParameters.programId, evt.queryStringParameters, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.issuances
            };
        });

    router.route("/v2/programs/{programId}/issuances")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:issuances:create");

            evt.validateBody(issuanceSchema);
            evt.body.programId = evt.pathParameters.programId;

            const now = nowInDbPrecision();
            const issuance: Issuance = {
                ...pickOrDefault(evt.body,
                    {
                        id: null,
                        name: null,
                        programId: null,
                        count: null,
                        balance: null,
                        redemptionRule: null,
                        balanceRule: null,
                        usesRemaining: null,
                        active: null,
                        startDate: null,
                        endDate: null,
                        metadata: null
                    }
                ),
                createdDate: now,
                updatedDate: now,
                createdBy: auth.teamMemberId
            };

            issuance.startDate = issuance.startDate && dateInDbPrecision(new Date(issuance.startDate));
            issuance.endDate = issuance.endDate && dateInDbPrecision(new Date(issuance.endDate));

            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createIssuance(auth, issuance, {
                    isGenericCode: evt.body.isGenericCode,
                    generateCode: evt.body.generateCode,
                    code: evt.body.code
                })
            };
        });

    router.route("/v2/programs/{programId}/issuances/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:issuances:read");
            return {
                body: await getIssuance(auth, evt.pathParameters.programId, evt.pathParameters.id)
            };
        });
}

async function getIssuances(auth: giftbitRoutes.jwtauth.AuthorizationBadge, programId: string, filterParams: { [key: string]: string }, pagination: PaginationParams): Promise<{ issuances: Issuance[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();

    const res = await filterAndPaginateQuery<DbIssuance>(
        knex("Issuances")
            .where({
                userId: auth.userId,
                programId: programId
            }),
        filterParams,
        {
            properties: {
                "id": {
                    type: "string",
                    operators: ["eq", "in"]
                },
                "count": {
                    type: "number",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
                "usesRemaining": {
                    type: "number",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
                "startDate": {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
                "endDate": {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
                "createdDate": {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                }
            }
        },
        pagination
    );

    return {
        issuances: res.body.map(DbIssuance.toIssuance),
        pagination: res.pagination
    };
}

async function createIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, issuance: Issuance, codeParameters: CodeParameters): Promise<Issuance> {
    auth.requireIds("userId", "teamMemberId");
    let program: Program = await getProgram(auth, issuance.programId);
    log.info(`Creating issuance for userId: ${auth.userId}. Issuance:`, issuance);

    // copy over properties from program that may be null.
    // this is important for issuance display and history since these properties can be updated on the program.
    issuance = {
        ...issuance,
        ...pick<Partial<Issuance>>(program, "startDate", "endDate", "balanceRule", "redemptionRule", "active"),
        ...pickNotNull(issuance)
    };
    issuance.metadata = {...(program && program.metadata ? program.metadata : {}), ...issuance.metadata};

    checkIssuanceConstraints(issuance, program, codeParameters);
    try {
        const dbIssuance: DbIssuance = Issuance.toDbIssuance(auth, issuance);
        const knex = await getKnexWrite();
        await knex.transaction(async trx => {
            await trx.into("Issuances")
                .insert(dbIssuance);
            const issuancePaddingWidth = (issuance.count - 1 /* -1 since ids start at 0 */).toString().length;
            for (let i = 0; i < issuance.count; i++) {
                const partialValue: Partial<Value> = {
                    id: issuance.id + "-" + padValueIdForIssuance(i, issuancePaddingWidth) /* padding is for nice sorting in CSV lists */,
                    code: codeParameters.code,
                    isGenericCode: codeParameters.isGenericCode ? codeParameters.isGenericCode : false,
                    issuanceId: issuance.id,
                    balance: (issuance.balance == null && issuance.balanceRule == null) ? 0 : issuance.balance,
                    redemptionRule: issuance.redemptionRule ? issuance.redemptionRule : null,
                    balanceRule: issuance.balanceRule ? issuance.balanceRule : null,
                    usesRemaining: issuance.usesRemaining ? issuance.usesRemaining : null,
                    active: issuance.active,
                    startDate: issuance.startDate ? issuance.startDate : null,
                    endDate: issuance.endDate ? issuance.endDate : null,
                    metadata: issuance.metadata
                };
                await createValue(auth, {
                    partialValue: partialValue,
                    generateCodeParameters: codeParameters.generateCode,
                    program: program
                }, trx);
            }
        });
        log.info("Finished creating issuance: ", issuance);
        return DbIssuance.toIssuance(dbIssuance);
    } catch (err) {
        log.debug(err);
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Issuance with id '${issuance.id}' already exists.`);
        }
        throw err;
    }
}

export function padValueIdForIssuance(num: number, width: number) {
    const numLength = num.toString().length;
    return numLength >= width ? num : new Array(width - numLength + 1).join("0") + num;
}

function checkIssuanceConstraints(issuance: Issuance, program: Program, codeParameters: CodeParameters): void {
    log.debug(`Checking for logical issues on issuance ${issuance.id}`);
    if (issuance.count > 1 && codeParameters.code) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Issuance count must be 1 if code is set.`);
    }
    if (codeParameters.isGenericCode && issuance.count > 1) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Issuance count must be 1 if isGenericCode:true.`);
    }
    if (codeParameters.code && issuance.count > 1) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `Issuance count must be 1 if providing a code.`);
    }
}

export async function getIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, programId: string, id: string): Promise<Issuance> {
    auth.requireIds("userId");
    log.info(`Getting issuance by id ${id}`);

    const knex = await getKnexRead();
    const res: DbIssuance[] = await knex("Issuances")
        .select()
        .where({
            userId: auth.userId,
            programId: programId,
            id: id
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbIssuance.toIssuance(res[0]);
}

const issuanceSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 58, /* Values created are based off this id. Leaves room for suffixing the Values index. ie `${id}-${index}` */
            minLength: 1,
            pattern: "^[ -~]*$"
        },
        name: {
            type: "string",
            maxLength: 65535,
            minLength: 1
        },
        count: {
            type: "integer",
            minimum: 1,
            maximum: 10000
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
        active: {
            type: "boolean"
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
    required: ["id", "name", "count"],
};

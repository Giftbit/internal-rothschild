import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {Program} from "../../model/Program";
import {csvSerializer} from "../../serializers";
import {pick, pickNotNull, pickOrDefault} from "../../utils/pick";
import {dateInDbPrecision, nowInDbPrecision} from "../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {paginateQuery} from "../../utils/dbUtils/paginateQuery";
import * as log from "loglevel";
import {DbIssuance, Issuance} from "../../model/Issuance";
import {getProgram} from "./programs";
import {Value} from "../../model/Value";
import {CodeParameters} from "../../model/CodeParameters";
import {createValue} from "./values";

export function installIssuancesRest(router: cassava.Router): void {
    router.route("/v2/programs/{id}/issuances")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:issuances:list");
            const res = await getIssuances(auth, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.issuances
            };
        });

    router.route("/v2/programs/{id}/issuances")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:issuances:create");
            evt.body.programId = evt.pathParameters.id;
            evt.validateBody(issuanceSchema);

            const now = nowInDbPrecision();
            const issuance: Issuance = {
                ...pickOrDefault(evt.body,
                    {
                        id: null,
                        programId: null,
                        count: null,
                        balance: null,
                        redemptionRule: null,
                        valueRule: null,
                        uses: null,
                        startDate: null,
                        endDate: null,
                        metadata: null
                    }
                ),
                createdDate: now,
                updatedDate: now
            };

            issuance.startDate = issuance.startDate ? dateInDbPrecision(new Date(issuance.startDate)) : null;
            issuance.endDate = issuance.endDate ? dateInDbPrecision(new Date(issuance.endDate)) : null;

            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createIssuance(auth, issuance, {
                    isGenericCode: evt.body.isGenericCode,
                    generateCode: evt.body.generateCode,
                    code: evt.body.code
                })
            };
        });

    router.route("/v2/programs/{id}/issuances/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:issuances:read");
            return {
                body: await getIssuance(auth, evt.pathParameters.id)
            };
        });
}

async function getIssuances(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams): Promise<{ issuances: Issuance[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res = await paginateQuery<DbIssuance>(
        knex("Issuances")
            .where({
                userId: auth.userId
            }),
        pagination
    );

    return {
        issuances: res.body.map(DbIssuance.toIssuance),
        pagination: res.pagination
    };
}

async function createIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, issuance: Issuance, codeParameters: CodeParameters): Promise<Issuance> {
    auth.requireIds("userId");
    let program: Program = await getProgram(auth, issuance.programId);
    log.info(`Creating issuance for userId: ${auth.userId}. Issuance: ${JSON.stringify(issuance)}`);

    // copy over properties from program that may be null.
    // this is important for issuance display and history since these properties can be updated on the program.
    issuance = {
        ...issuance,
        ...pick<Partial<Issuance>>(program, "startDate", "endDate", "valueRule", "redemptionRule"),
        ...pickNotNull(issuance)
    };

    checkIssuanceConstraints(issuance, program, codeParameters);

    try {
        const dbIssuance: DbIssuance = Issuance.toDbIssuance(auth, issuance);
        const knex = await getKnexWrite();
        await knex.transaction(async trx => {
            await trx.into("Issuances")
                .insert(dbIssuance);
            for (let i = 0; i < issuance.count; i++) {
                const partialValue: Partial<Value> = {
                    id: issuance.id + "-" + i.toString(),
                    code: codeParameters.code,
                    isGenericCode: codeParameters.isGenericCode
                };
                await createValue({
                    partialValue: partialValue,
                    generateCodeParameters: codeParameters.generateCode,
                    program: program,
                    issuance: issuance,
                    returnFullCode: false
                }, trx, auth);
            }
        });
        return DbIssuance.toIssuance(dbIssuance);
    } catch (err) {
        log.debug(err);
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Issuance with id '${issuance.id}' already exists.`);
        }
        throw err;
    }
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

export async function getIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Issuance> {
    auth.requireIds("userId");
    log.info(`Getting issuance by id ${id}`);

    const knex = await getKnexRead();
    const res: DbIssuance[] = await knex("Issuances")
        .select()
        .where({
            userId: auth.userId,
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
            maxLength: 26, /* Values created are based off this id. Leaves room for suffixing the Values index. ie `${id}-${index}` */
            minLength: 1
        },
        programId: {
            type: "string",
            maxLength: 32,
            minLength: 1
        },
        count: {
            type: ["integer"],
            minimum: 0,
            maximum: 1000
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
    required: ["id", "programId", "count"],
};

import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {DbProgram, Program} from "../../model/Program";
import {csvSerializer} from "../../serializers";
import {pickOrDefault} from "../../utils/pick";
import {dateInDbPrecision, getSqlErrorConstraintName, nowInDbPrecision} from "../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {paginateQuery} from "../../utils/dbUtils/paginateQuery";
import * as log from "loglevel";
import {Issuance} from "../../model/Issuance";
import {getProgram} from "./programs";
import {Value} from "../../model/Value";
import {CodeParameters} from "../../model/CodeParameters";

export function installIssuancesRest(router: cassava.Router): void {
    router.route("/v2/programs/{id}/issuances")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const res = await getIssuances(auth, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.programs
            };
        });

    router.route("/v2/programs/{id}/issuances")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
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

            // todo - I'm not sure this is something we want?
            // if (evt.body.generateCode) {
            //     issuance.metadata = {
            //         ...issuance.metadata,
            //         codeProperties: evt.body.generateCode
            //     }
            // }

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
            auth.requireIds("giftbitUserId");
            return {
                body: await getIssuance(auth, evt.pathParameters.id)
            };
        });


}

async function getIssuances(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams): Promise<{ programs: Program[], pagination: Pagination }> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res = await paginateQuery<DbProgram>(
        knex("Programs")
            .where({
                userId: auth.giftbitUserId
            }),
        pagination
    );

    return {
        programs: res.body.map(DbProgram.toProgram),
        pagination: res.pagination
    };
}

async function createIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, issuance: Issuance, codeProperties: CodeParameters): Promise<Issuance> {
    auth.requireIds("giftbitUserId");
    let program: Program = null;
    try {
        program = await getProgram(auth, issuance.programId);
    } catch (err) {
        if (err instanceof cassava.RestError && err.statusCode === 404) {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `No Program found for id ${issuance.programId}.`);
        } else {
            throw err;
        }
    }

    // todo - check if issuance properties are allowed given program
    // todo - create a value from Program // extra the part of values.ts that does this.
    // todo - modify value from issuance

    try {
        const knex = await getKnexWrite();
        const now = nowInDbPrecision();
        await knex.transaction(async trx => {
            await trx.into("Issuances")
                .insert(Issuance.toDbIssuance(auth, issuance));
            // error handling...
            try {
                for (let i = 0; i < issuance.count; i++) {
                    const value: Value = {
                        id: issuance.id + "-" + i.toString(), // todo - there is a length issue here.
                        currency: program ? program.currency : "",
                        balance: 0,
                        uses: null,
                        programId: program ? program.id : null,
                        code: null,//generateCode({}),
                        isGenericCode: null,
                        // code: evt.body.generateCode ? generateCode(evt.body.generateCode) : null,
                        // isGenericCode: evt.body.generateCode ? false : null,
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
                        metadata: null,
                        canceled: false,
                        createdDate: now,
                        updatedDate: now
                    };
                    // await insertValue(auth, value, trx);
                }
            } catch (err) {
                console.log(JSON.stringify(err));
            }
        });

        return issuance;
    } catch (err) {
        log.debug(err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Program with id '${issuance.id}' already exists.`, "ProgramIdExists");
        }
        throw err;
    }
}

function checkIssuanceConstraints(issuance: Issuance, program: Program, codeParameters: CodeParameters) {
    // check program vs. issuance
    if (issuance.valueRule && !program.valueRule) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Issuance cannot use a valueRule if Program has no valueRule.`);
    }
    if (issuance.balance && program.valueRule) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Issuance cannot use balance if Program has no valueRule.`);
    }

    // check for logical issues
    if (issuance.count > 1 && codeParameters.code) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Issuance count must be 1 if code is set.`);
    }
    // if (issuance.startDate < issuance.startDate)
    //
    //     }
}

export async function getIssuance(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Program> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbProgram[] = await knex("Programs")
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
    return DbProgram.toProgram(res[0]);
}

const issuanceSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 26, /* values created are based off of this id */
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

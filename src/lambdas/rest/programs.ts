import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {DbProgram, Program} from "../../model/Program";
import {csvSerializer} from "../../serializers";
import {pick, pickOrDefault} from "../../utils/pick";
import {
    dateInDbPrecision,
    filterAndPaginateQuery,
    getSqlErrorConstraintName,
    nowInDbPrecision
} from "../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import log = require("loglevel");
import {checkRulesSyntax} from "./values";

export function installProgramsRest(router: cassava.Router): void {
    router.route("/v2/programs")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:programs:list");

            const res = await getPrograms(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.programs
            };
        });

    router.route("/v2/programs")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId", "teamMemberId");
            auth.requireScopes("lightrailV2:programs:create");
            evt.validateBody(programSchema);

            const now = nowInDbPrecision();
            const program: Program = {
                ...pickOrDefault(evt.body,
                    {
                        id: "",
                        name: "",
                        currency: "",
                        discount: true,
                        discountSellerLiability: null,
                        pretax: true,
                        active: true,
                        redemptionRule: null,
                        balanceRule: null,
                        minInitialBalance: null,
                        maxInitialBalance: null,
                        fixedInitialBalances: null,
                        fixedInitialUsesRemaining: null,
                        startDate: null,
                        endDate: null,
                        metadata: null
                    }
                ),
                createdDate: now,
                updatedDate: now,
                createdBy: auth.teamMemberId,
            };

            program.startDate = program.startDate ? dateInDbPrecision(new Date(program.startDate)) : null;
            program.endDate = program.endDate ? dateInDbPrecision(new Date(program.endDate)) : null;

            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createProgram(auth, program)
            };
        });

    router.route("/v2/programs/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:programs:read");

            const program = await getProgram(auth, evt.pathParameters.id);

            if (evt.queryStringParameters.stats === "true") {
                // For now this is a secret param only the web app knows about.
                await injectProgramStats(auth, program);
            }

            return {
                body: program
            };
        });

    router.route("/v2/programs/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:programs:update");
            evt.validateBody(updateProgramSchema);

            if (evt.body.id && evt.body.id !== evt.pathParameters.id) {
                throw new giftbitRoutes.GiftbitRestError(422, `The body id '${evt.body.id}' does not match the path id '${evt.pathParameters.id}'.  The id cannot be updated.`);
            }

            const now = nowInDbPrecision();
            const program: Partial<Program> = {
                ...pick(evt.body as Program, "name", "discount", "pretax", "active", "redemptionRule", "balanceRule", "minInitialBalance", "maxInitialBalance", "fixedInitialBalances", "fixedInitialUsesRemaining", "startDate", "endDate", "metadata"),
                updatedDate: now
            };

            return {
                body: await updateProgram(auth, evt.pathParameters.id, program)
            };
        });

    router.route("/v2/programs/{id}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:programs:delete");
            return {
                body: await deleteProgram(auth, evt.pathParameters.id)
            };
        });

}

async function getPrograms(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams): Promise<{ programs: Program[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();

    const res = await filterAndPaginateQuery<DbProgram>(
        knex("Programs")
            .where({
                userId: auth.userId
            }),
        filterParams,
        {
            properties: {
                "id": {
                    type: "string",
                    operators: ["eq", "in"]
                },
                "currency": {
                    type: "string",
                    operators: ["eq", "in"]
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
                },
                "updatedDate": {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                }
            }
        },
        pagination
    );

    return {
        programs: res.body.map(DbProgram.toProgram),
        pagination: res.pagination
    };
}

async function createProgram(auth: giftbitRoutes.jwtauth.AuthorizationBadge, program: Program): Promise<Program> {
    auth.requireIds("userId");
    checkProgramProperties(program);
    try {
        let dbProgram = Program.toDbProgram(auth, program);
        const knex = await getKnexWrite();
        await knex("Programs")
            .insert(dbProgram);
        return DbProgram.toProgram(dbProgram);
    } catch (err) {
        log.debug(err);
        const constraint = getSqlErrorConstraintName(err);
        if (constraint === "PRIMARY") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `A Program with id '${program.id}' already exists.`, "ProgramIdExists");
        }
        if (constraint === "fk_Programs_Currencies") {
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Currency '${program.currency}' does not exist. See the documentation on creating currencies.`, "CurrencyNotFound");
        }
        throw err;
    }
}

export async function getProgram(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Program> {
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res: DbProgram[] = await knex("Programs")
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
    return DbProgram.toProgram(res[0]);
}

async function updateProgram(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, programUpdates: Partial<Program>): Promise<Program> {
    auth.requireIds("userId");

    const knex = await getKnexWrite();
    return await knex.transaction(async trx => {
        // Get the master version of the Program and lock it.
        const selectProgramRes: DbProgram[] = await trx("Programs")
            .select()
            .where({
                userId: auth.userId,
                id: id
            })
            .forUpdate();
        if (selectProgramRes.length === 0) {
            throw new cassava.RestError(404);
        }
        if (selectProgramRes.length > 1) {
            throw new Error(`Illegal SELECT query.  Returned ${selectProgramRes.length} values.`);
        }
        const existingProgram = DbProgram.toProgram(selectProgramRes[0]);
        const updatedProgram = {
            ...existingProgram,
            ...programUpdates
        };

        checkProgramProperties(updatedProgram);

        const patchRes = await trx("Programs")
            .where({
                userId: auth.userId,
                id: id
            })
            .update(Program.toDbProgramUpdate(auth, programUpdates));
        if (patchRes === 0) {
            throw new cassava.RestError(404);
        }
        if (patchRes > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${patchRes.length} values.`);
        }
        return updatedProgram;
    });
}


async function deleteProgram(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<{ success: true }> {
    auth.requireIds("userId");

    const knex = await getKnexWrite();
    const res = await knex("Programs")
        .where({
            userId: auth.userId,
            id: id
        })
        .delete();
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal DELETE query.  Deleted ${res.length} values.`);
    }
    return {success: true};
}

function checkProgramProperties(program: Program): void {
    if (program.minInitialBalance != null && program.maxInitialBalance != null && program.minInitialBalance > program.maxInitialBalance) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Program's minInitialBalance cannot exceed maxInitialBalance.");
    }

    checkRulesSyntax(program, "Program");
}

/**
 * This is currently a secret operation only the web app knows about.
 */
export async function injectProgramStats(auth: giftbitRoutes.jwtauth.AuthorizationBadge, program: Program): Promise<void> {
    auth.requireIds("userId");

    const now = nowInDbPrecision();
    const knex = await getKnexRead();
    const res: { sumBalance: number, count: number, canceled: boolean, expired: boolean, active: boolean }[] = await knex("Values")
        .where({
            "userId": auth.userId,
            "programId": program.id
        })
        .select({
            canceled: "canceled",
            active: "active"
        })
        .select(knex.raw("endDate = NULL OR endDate < ? AS expired", [now]))
        .sum({
            sumBalance: "balance"
        })
        .count({
            count: "*"
        })
        .groupBy("canceled", "expired", "active");

    const stats = {
        outstanding: {
            balance: 0,
            count: 0
        },
        canceled: {
            balance: 0,
            count: 0
        },
        expired: {
            balance: 0,
            count: 0
        }
    };

    console.log("res=", res);

    for (const resLine of res) {
        if (resLine.canceled) {
            stats.canceled.balance += +resLine.sumBalance;  // for some reason SUM() comes back as a string
            stats.canceled.count += resLine.count;
        } else if (resLine.expired) {
            stats.expired.balance += +resLine.sumBalance;
            stats.expired.count += resLine.count;
        } else if (resLine.active) {
            stats.outstanding.balance += +resLine.sumBalance;
            stats.outstanding.count += resLine.count;
        }
    }

    (program as any).stats = stats;
}

const programSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 32,
            minLength: 1
        },
        name: {
            type: "string",
            maxLength: 65535,
            minLength: 1
        },
        currency: {
            type: "string",
            minLength: 1,
            maxLength: 16
        },
        discount: {
            type: "boolean"
        },
        discountSellerLiability: {
            type: ["number", "null"],
            minimum: 0,
            maximum: 1
        },
        pretax: {
            type: "boolean"
        },
        active: {
            type: "boolean"
        },
        redemptionRule: {
            oneOf: [ // todo can we export this schema for a rule so that it's not duplicated?
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
        minInitialBalance: {
            type: ["number", "null"],
            minimum: 0
        },
        maxInitialBalance: {
            type: ["number", "null"],
            minimum: 0
        },
        fixedInitialBalances: {
            type: ["array", "null"],
            items: {
                type: "number",
                minimum: 0
            }
        },
        fixedInitialUsesRemaining: {
            type: ["array", "null"],
            items: {
                type: "number",
                minimum: 1
            }
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
    required: ["id", "name", "currency"]
};
const updateProgramSchema: jsonschema.Schema = {
    ...programSchema,
    required: []
};

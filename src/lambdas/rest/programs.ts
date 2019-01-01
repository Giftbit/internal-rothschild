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
import {checkRulesSyntax} from "./values";
import {ProgramStats} from "../../model/ProgramStats";
import log = require("loglevel");

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
                        discount: false,
                        discountSellerLiability: null,
                        pretax: false,
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

    router.route("/v2/programs/{id}/stats")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:programs:read");
            return {
                body: await getProgramStats(auth, evt.pathParameters.id)
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
                "name": {
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

    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Programs")
            .where({
                userId: auth.userId,
                id: id
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
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Program '${id}' is in use.`, "ProgramInUse");
        }
        throw err;
    }
}

function checkProgramProperties(program: Program): void {
    if (program.minInitialBalance != null && program.maxInitialBalance != null && program.minInitialBalance > program.maxInitialBalance) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Program's minInitialBalance cannot exceed maxInitialBalance.");
    }

    if (program.balanceRule && (program.minInitialBalance != null || program.maxInitialBalance != null || program.fixedInitialBalances.length > 0)) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Program cannot have a balanceRule when also defining minInitialBalance, maxInitialBalance or fixedInitialBalances.");
    }

    if ((program.minInitialBalance != null || program.maxInitialBalance != null) && program.fixedInitialBalances.length > 0) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, "Program cannot have fixedInitialBalances defined when also defining minInitialBalance or maxInitialBalance");
    }

    checkRulesSyntax(program, "Program");
}

/**
 * This is currently a secret operation only the web app knows about.
 */
export async function getProgramStats(auth: giftbitRoutes.jwtauth.AuthorizationBadge, programId: string): Promise<ProgramStats> {
    auth.requireIds("userId");

    const startTime = Date.now();
    const stats: ProgramStats = {
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
        },
        redeemed: {
            balance: 0,
            count: 0,
            transactionCount: 0
        },
        checkout: {
            lightrailSpend: 0,
            overspend: 0,
            transactionCount: 0
        }
    };

    const now = nowInDbPrecision();
    const knex = await getKnexRead();
    const valueStatsRes: { sumBalance: number, count: number, canceled: boolean, expired: boolean }[] = await knex("Values")
        .where({
            "userId": auth.userId,
            "programId": programId,
            "active": true
        })
        .where(query =>
            query.where("balance", ">", 0)
                .orWhereNull("balance")
        )
        .select("canceled")
        .select(knex.raw("endDate IS NOT NULL AND endDate < ? AS expired", [now]))
        .sum({sumBalance: "balance"})
        .count({count: "*"})
        .groupBy("canceled", "expired");
    for (const valueStatsResLine of valueStatsRes) {
        if (valueStatsResLine.canceled) {
            // Includes canceled AND expired.
            stats.canceled.balance += +valueStatsResLine.sumBalance;  // for some reason SUM() comes back as a string
            stats.canceled.count += valueStatsResLine.count;
        } else if (valueStatsResLine.expired) {
            stats.expired.balance += +valueStatsResLine.sumBalance;
            stats.expired.count += valueStatsResLine.count;
        } else {
            stats.outstanding.balance += +valueStatsResLine.sumBalance;
            stats.outstanding.count += valueStatsResLine.count;
        }
    }

    log.info(`injectProgramStats got value stats ${Date.now() - startTime}ms`);

    const redeemedStatsRes: {
        balance: number,
        transactionCount: number,
        valueCount: number
    }[] = await knex("Values")
        .where({
            "Values.userId": auth.userId,
            "Values.programId": programId,
            "Values.active": true
        })
        .join("LightrailTransactionSteps", {
            "LightrailTransactionSteps.userId": "Values.userId",
            "LightrailTransactionSteps.valueId": "Values.id"
        })
        .join("Transactions", {
            "Transactions.userId": "LightrailTransactionSteps.userId",
            "Transactions.id": "LightrailTransactionSteps.transactionId"
        })
        .join("Transactions as TransactionRoots", {
            "TransactionRoots.userId": "Transactions.userId",
            "TransactionRoots.id": "Transactions.rootTransactionId"
        })
        .whereIn("TransactionRoots.transactionType", ["checkout", "debit"])
        .sum({balance: "LightrailTransactionSteps.balanceChange"})
        .countDistinct({transactionCount: "TransactionRoots.id"})
        .countDistinct({valueCount: "Values.id"});

    stats.redeemed.count = redeemedStatsRes[0].valueCount;
    stats.redeemed.balance = -redeemedStatsRes[0].balance;
    stats.redeemed.transactionCount = redeemedStatsRes[0].transactionCount;

    log.info(`injectProgramStats got redeemed stats ${Date.now() - startTime}ms`);

    const overspendStatsRes: {
        lrBalance: number,
        iBalance: number,
        sBalance: number,
        remainder: number,
        transactionCount: number
    }[] = await knex
        .from(knex.raw("? as Txs", [
            // Get unique Transaction IDs of Transactions with a root checkout Transaction and steps with Values in this Program
            knex("Values")
                .where({
                    "Values.userId": auth.userId,
                    "Values.programId": programId,
                    "Values.active": true
                })
                .join("LightrailTransactionSteps", {
                    "LightrailTransactionSteps.userId": "Values.userId",
                    "LightrailTransactionSteps.valueId": "Values.id"
                })
                .join("Transactions", {
                    "Transactions.userId": "LightrailTransactionSteps.userId",
                    "Transactions.id": "LightrailTransactionSteps.transactionId"
                })
                .join("Transactions as TransactionRoots", {
                    "TransactionRoots.userId": "Transactions.userId",
                    "TransactionRoots.id": "Transactions.rootTransactionId"
                })
                .where({"TransactionRoots.transactionType": "checkout"})
                .select("Transactions.rootTransactionId")
                .distinct("Transactions.id", "Transactions.totals_remainder")
        ]))
        .leftJoin(
            // For each Transaction: sum LightrailTransactionSteps.balanceChange
            knex.raw(
                "? as LightrailBalances on LightrailBalances.transactionId = Txs.id",
                [
                    knex("LightrailTransactionSteps")
                        .where({userId: auth.userId})
                        .groupBy("transactionId")
                        .sum("balanceChange as balanceChange")
                        .select("transactionId")
                ]
            )
        )
        .leftJoin(
            // For each Transaction: sum InternalTransactionSteps.balanceChange
            knex.raw(
                "? as InternalBalances on InternalBalances.transactionId = Txs.id",
                [
                    knex("InternalTransactionSteps")
                        .where({userId: auth.userId})
                        .groupBy("transactionId")
                        .sum("balanceChange as balanceChange")
                        .select("transactionId")
                ]
            )
        )
        .leftJoin(
            // For each Transaction: sum StripeTransactionSteps.amount
            knex.raw(
                "? as StripeAmounts on StripeAmounts.transactionId = Txs.id",
                [
                    knex("StripeTransactionSteps")
                        .where({userId: auth.userId})
                        .groupBy("transactionId")
                        .sum("amount as amount")
                        .select("transactionId")
                ]
            )
        )
        .countDistinct({transactionCount: "Txs.rootTransactionId"})
        .sum({remainder: "Txs.totals_remainder"})
        .sum({lrBalance: "LightrailBalances.balanceChange"})
        .sum({iBalance: "InternalBalances.balanceChange"})
        .sum({sBalance: "StripeAmounts.amount"});
    stats.checkout.transactionCount = overspendStatsRes[0].transactionCount;
    stats.checkout.lightrailSpend = -overspendStatsRes[0].lrBalance;
    stats.checkout.overspend = -overspendStatsRes[0].iBalance - overspendStatsRes[0].sBalance + +overspendStatsRes[0].remainder;

    log.info(`injectProgramStats got overspend stats and done ${Date.now() - startTime}ms`);

    return stats;
}

const programSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 64,
            minLength: 1,
            pattern: "^[ -~]*$"
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

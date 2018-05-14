import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {DbValueStoreTemplate, ValueStoreTemplate} from "../../model/ValueStoreTemplate";
import {csvSerializer} from "../../serializers";
import {getKnexWrite, getKnexRead, nowInDbPrecision} from "../../dbUtils";

export function installValueStoreTemplatesRest(router: cassava.Router): void {
    router.route("/v2/valueStoreTemplates")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const res = await getValueStoreTemplates(auth, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(res.pagination),
                body: res.valueStoreTemplates
            };
        });

    router.route("/v2/valueStoreTemplates")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueStoreTemplateSchema);
            const now = nowInDbPrecision();
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createValueStoreTemplate(auth, {
                    valueStoreTemplateId: evt.body.valueStoreTemplateId,
                    valueStoreType: evt.body.valueStoreType !== undefined ? evt.body.valueStoreType : null,
                    initialValue: evt.body.initialValue !== undefined ? evt.body.initialValue : null,
                    pretax: evt.body.pretax != null ? evt.body.pretax : false,
                    minInitialValue: evt.body.minInitialValue !== undefined ? evt.body.minInitialValue : null,
                    maxInitialValue: evt.body.maxInitialValue !== undefined ? evt.body.maxInitialValue : null,
                    currency: evt.body.currency !== undefined ? evt.body.currency : null,
                    startDate: evt.body.startDate !== undefined ? evt.body.startDate : null,
                    endDate: evt.body.endDate !== undefined ? evt.body.endDate : null,
                    validityDurationDays: evt.body.validityDurationDays !== undefined ? evt.body.validityDurationDays : null,
                    uses: evt.body.uses !== undefined ? evt.body.uses : null,
                    redemptionRule: evt.body.redemptionRule !== undefined ? evt.body.redemptionRule : null,
                    valueRule: evt.body.valueRule !== undefined ? evt.body.valueRule : null,
                    metadata: evt.body.metadata !== undefined ? evt.body.metadata : null,
                    createdDate: now,
                    updatedDate: now,
                })
            };
        });

    router.route("/v2/valueStoreTemplates/{valueStoreTemplateId}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getValueStoreTemplate(auth, evt.pathParameters.valueStoreTemplateId)
            };
        });

    router.route("/v2/valueStoreTemplates/{valueStoreTemplateId}")
        .method("PUT")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueStoreTemplateSchema);

            const now = nowInDbPrecision();
            return {
                body: await updateValueStoreTemplate(auth, {
                    valueStoreTemplateId: evt.pathParameters.valueStoreTemplateId,
                    valueStoreType: evt.body.valueStoreType !== undefined ? evt.body.valueStoreType : null,
                    initialValue: evt.body.initialValue !== undefined ? evt.body.initialValue : null,
                    pretax: evt.body.pretax != null ? evt.body.pretax : false,
                    minInitialValue: evt.body.minInitialValue !== undefined ? evt.body.minInitialValue : null,
                    maxInitialValue: evt.body.maxInitialValue !== undefined ? evt.body.maxInitialValue : null,
                    currency: evt.body.currency !== undefined ? evt.body.currency : null,
                    startDate: evt.body.startDate !== undefined ? evt.body.startDate : null,
                    endDate: evt.body.endDate !== undefined ? evt.body.endDate : null,
                    validityDurationDays: evt.body.validityDurationDays !== undefined ? evt.body.validityDurationDays : null,
                    uses: evt.body.uses !== undefined ? evt.body.uses : null,
                    redemptionRule: evt.body.redemptionRule !== undefined ? evt.body.redemptionRule : null,
                    valueRule: evt.body.valueRule !== undefined ? evt.body.valueRule : null,
                    metadata: evt.body.metadata !== undefined ? evt.body.metadata : null,
                    updatedDate: now
                })
            };
        });

    router.route("/v2/valueStoreTemplates/{valueStoreTemplateId}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteValueStoreTemplate(auth, evt.pathParameters.valueStoreTemplateId)
            };
        });

}

async function getValueStoreTemplates(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams): Promise<{ valueStoreTemplates: ValueStoreTemplate[], pagination: Pagination }> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValueStoreTemplate[] = await knex("ValueStoreTemplates")
        .select()
        .where({
            userId: auth.giftbitUserId
        })
        .orderBy("valueStoreTemplateId")
        .limit(pagination.limit)
        .offset(pagination.offset);

    return {
        valueStoreTemplates: res.map(DbValueStoreTemplate.toValueStoreTemplate),
        pagination: {
            limit: pagination.limit,
            maxLimit: pagination.maxLimit,
            offset: pagination.offset
        }
    };
}

async function createValueStoreTemplate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreTemplate: ValueStoreTemplate): Promise<ValueStoreTemplate> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        await knex("ValueStoreTemplates")
            .insert(ValueStoreTemplate.toDbValueStoreTemplate(auth, valueStoreTemplate));
        return valueStoreTemplate;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStoreTemplate with valueStoreTemplateId '${valueStoreTemplate.valueStoreTemplateId}' already exists.`);
        }
        throw err;
    }
}

async function getValueStoreTemplate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreTemplateId: string): Promise<ValueStoreTemplate> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbValueStoreTemplate[] = await knex("ValueStoreTemplates")
        .select()
        .where({
            userId: auth.giftbitUserId,
            valueStoreTemplateId
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbValueStoreTemplate.toValueStoreTemplate(res[0]);
}

async function updateValueStoreTemplate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreTemplate: Partial<ValueStoreTemplate>): Promise<ValueStoreTemplate> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("ValueStoreTemplates")
        .where({
            userId: auth.giftbitUserId,
            valueStoreTemplateId: valueStoreTemplate.valueStoreTemplateId
        })
        .update({
            valueStoreType: valueStoreTemplate.valueStoreType,
            initialValue: valueStoreTemplate.initialValue,
            pretax: valueStoreTemplate.pretax,
            minInitialValue: valueStoreTemplate.minInitialValue,
            maxInitialValue: valueStoreTemplate.maxInitialValue,
            currency: valueStoreTemplate.currency,
            startDate: valueStoreTemplate.startDate,
            endDate: valueStoreTemplate.endDate,
            validityDurationDays: valueStoreTemplate.validityDurationDays,
            uses: valueStoreTemplate.uses,
            redemptionRule: JSON.stringify(valueStoreTemplate.redemptionRule),
            valueRule: JSON.stringify(valueStoreTemplate.valueRule),
            metadata: JSON.stringify(valueStoreTemplate.metadata),
            updatedDate: valueStoreTemplate.updatedDate
        });
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
    }
    return getValueStoreTemplate(auth, valueStoreTemplate.valueStoreTemplateId);
}


async function deleteValueStoreTemplate(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueStoreTemplateId: string): Promise<{ success: true }> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("ValueStoreTemplates")
        .where({
            userId: auth.giftbitUserId,
            valueStoreTemplateId
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

const valueStoreTemplateSchema: jsonschema.Schema = {
    type: "object",
    properties: {
        valueStoreTemplateId: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        valueStoreType: {
            type: "string",
            enum: ["PREPAID", "PERCENT_OFF", "UNIT"]
        },
        value: {
            type: ["integer", "null"],
            minimum: 0
        },
        minInitialValue: {
            type: ["number", "null"],
            minimum: 0
        },
        maxInitialValue: {
            type: ["number", "null"],
            minimum: 0
        },
        currency: {
            type: ["string"],
            minLength: 3,
            maxLength: 16
        },
        // todo - excluded this because this is set after request is verified by schema
        // createdDate: {
        //     type: ["string"],
        //     format: "date-time"
        // },
        // updatedDate: {
        //     type: ["string"],
        //     format: "date-time"
        // },
        startDate: {
            type: ["string", "null"],
            format: "date-time"
        },
        endDate: {
            type: ["string", "null"],
            format: "date-time"
        },
        uses: {
            type: ["integer", "null"],
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
        }
    },
    required: ["valueStoreTemplateId", "currency"] // excluded "createdDate", "updatedDate" for same reason
};

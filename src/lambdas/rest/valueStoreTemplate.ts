import * as cassava from "cassava";
import {RestError, ValidateBodyOptions} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";
import {ValueStoreTemplate} from "../../model/ValueStoreTemplate";
import {getKnex, getKnexRead} from "../../dbUtils";

export function installValueStoreTemplatesRest(router: cassava.Router): void {
    router.route("/v2/valueStoreTemplates")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getValueStoreTemplates(auth.giftbitUserId, getPaginationParams(evt))
            };
        });

    function validateBody(body: any, schema: jsonschema.Schema, options?: ValidateBodyOptions): void {
        const result = jsonschema.validate(body, schema, options);
        if (result.errors.length) {
            console.log("ERROR OCCURED: " + JSON.stringify(result.errors));
            const error = new RestError(
                options && typeof options.httpStatusCode === "number" ? options.httpStatusCode : 422,
                `The body has ${result.errors.length} validation error(s): ${result.errors.map(e => e.toString()).join(", ")}.`
            );
            console.log("error.message = " + error.message);
            throw error;
        }
    }

    router.route("/v2/valueStoreTemplates")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const now = new Date();
            console.log("before validate");
            try {
                // evt.validateBody(valueStoreTemplateSchema);
                validateBody(evt.body, valueStoreTemplateSchema);
            } catch (e) {
                console.log("WHOLE ERROR " + e);
            }
            console.log("after validate");
            now.setMilliseconds(0);
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createValueStoreTemplate({
                    userId: auth.giftbitUserId,
                    valueStoreTemplateId: evt.body.valueStoreTemplateId,
                    valueStoreType: evt.body.valueStoreType !== undefined ? evt.body.valueStoreType : null,
                    initialValue: evt.body.initialValue !== undefined ? evt.body.initialValue : null,
                    minInitialValue: evt.body.minInitialValue !== undefined ? evt.body.minInitialValue : null,
                    maxInitialValue: evt.body.maxInitialValue !== undefined ? evt.body.maxInitialValue : null,
                    currency: evt.body.currency !== undefined ? evt.body.currency : null,
                    startDate: evt.body.startDate !== undefined ? evt.body.startDate : null,
                    endDate: evt.body.endDate !== undefined ? evt.body.endDate : null,
                    validityDurationDays: evt.body.validityDurationDays !== undefined ? evt.body.validityDurationDays : null,
                    uses: evt.body.uses !== undefined ? evt.body.uses : null,
                    redemptionRule: evt.body.redemptionRule !== undefined ? evt.body.redemptionRule : null,
                    valueRule: evt.body.valueRule !== undefined ? evt.body.valueRule : null,
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
                body: await getValueStoreTemplate(auth.giftbitUserId, evt.pathParameters.valueStoreTemplateId)
            };
        });

    router.route("/v2/valueStoreTemplates/{valueStoreTemplateId}")
        .method("PUT")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueStoreTemplateSchema);

            const now = new Date();
            now.setMilliseconds(0);
            return {
                body: await updateValueStoreTemplate({
                    userId: auth.giftbitUserId,
                    valueStoreTemplateId: evt.pathParameters.valueStoreTemplateId,
                    valueStoreType: evt.body.valueStoreType !== undefined ? evt.body.valueStoreType : null,
                    initialValue: evt.body.initialValue !== undefined ? evt.body.initialValue : null,
                    minInitialValue: evt.body.minInitialValue !== undefined ? evt.body.minInitialValue : null,
                    maxInitialValue: evt.body.maxInitialValue !== undefined ? evt.body.maxInitialValue : null,
                    currency: evt.body.currency !== undefined ? evt.body.currency : null,
                    startDate: evt.body.startDate !== undefined ? evt.body.startDate : null,
                    endDate: evt.body.endDate !== undefined ? evt.body.endDate : null,
                    validityDurationDays: evt.body.validityDurationDays !== undefined ? evt.body.validityDurationDays : null,
                    uses: evt.body.uses !== undefined ? evt.body.uses : null,
                    redemptionRule: evt.body.redemptionRule !== undefined ? evt.body.redemptionRule : null,
                    valueRule: evt.body.valueRule !== undefined ? evt.body.valueRule : null,
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
                body: await deleteValueStoreTemplate(auth.giftbitUserId, evt.pathParameters.valueStoreTemplateId)
            };
        });

}

async function getValueStoreTemplates(userId: string, pagination: PaginationParams): Promise<{ valueStoreTemplates: ValueStoreTemplate[], pagination: Pagination }> {
    const knex = await getKnexRead();
    const res = await knex("ValueStoreTemplates")
        .select()
        .where({
            userId
        })
        .orderBy("customerId")
        .limit(pagination.limit)
        .offset(pagination.offset);

    return {
        valueStoreTemplates: res,
        pagination: {
            count: res.length,
            limit: pagination.limit,
            maxLimit: pagination.maxLimit,
            offset: pagination.offset
        }
    };
}

async function createValueStoreTemplate(valueStoreTemplate: ValueStoreTemplate): Promise<ValueStoreTemplate> {
    try {
        const knex = await getKnex();
        await knex("ValueStoreTemplates")
            .insert(valueStoreTemplate);
        return valueStoreTemplate;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStoreTemplate with valueStoreTemplateId '${valueStoreTemplate.valueStoreTemplateId}' already exists.`);
        }
        throw err;
    }
}

async function getValueStoreTemplate(userId: string, valueStoreTemplateId: string): Promise<ValueStoreTemplate> {
    const knex = await getKnexRead();
    const res = await knex("ValueStoreTemplates")
        .select()
        .where({
            userId,
            valueStoreTemplateId
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return res[0];
}

async function updateValueStoreTemplate(valueStoreTemplate: ValueStoreTemplate): Promise<ValueStoreTemplate> {
    const knex = await getKnex();
    const res = await knex("ValueStoreTemplates")
        .where({
            userId: valueStoreTemplate.userId,
            valueStoreTemplateId: valueStoreTemplate.valueStoreTemplateId
        })
        .update({
            valueStoreType: valueStoreTemplate.valueStoreType,
            initialValue: valueStoreTemplate.initialValue,
            minInitialValue: valueStoreTemplate.minInitialValue,
            maxInitialValue: valueStoreTemplate.maxInitialValue,
            currency: valueStoreTemplate.currency,
            startDate: valueStoreTemplate.startDate,
            endDate: valueStoreTemplate.endDate,
            validityDurationDays: valueStoreTemplate.validityDurationDays,
            uses: valueStoreTemplate.uses,
            redemptionRule: valueStoreTemplate.redemptionRule,
            valueRule: valueStoreTemplate.valueRule,
            updatedDate: valueStoreTemplate.updatedDate
        });
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
    }
    return getValueStoreTemplate(valueStoreTemplate.userId, valueStoreTemplate.valueStoreTemplateId);
}


async function deleteValueStoreTemplate(userId: string, valueStoreTemplateId: string): Promise<{ success: true }> {
    const knex = await getKnex();
    const res = await knex("ValueStoreTemplates")
        .where({
            userId,
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

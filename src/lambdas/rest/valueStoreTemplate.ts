import * as cassava from "cassava";
import {RestError, ValidateBodyOptions} from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {withDbConnection, withDbConnectionSelectOne, withDbReadConnection} from "../../dbUtils";
import {SqlSelectResponse} from "../../sqlResponses";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";
import {ValueStoreTemplate} from "../../model/ValueStoreTemplate";

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

    // router.route("/v2/customers/{customerId}")
    //     .method("PUT")
    //     .handler(async evt => {
    //         const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    //         auth.requireIds("giftbitUserId");
    //         evt.validateBody(valueStoreTemplateSchema);
    //
    //         const now = new Date();
    //         now.setMilliseconds(0);
    //         return {
    //             body: await updateCustomer({
    //                 userId: auth.giftbitUserId,
    //                 customerId: evt.pathParameters.customerId,
    //                 firstName: evt.body.firstName !== undefined ? evt.body.firstName : null,
    //                 lastName: evt.body.lastName !== undefined ? evt.body.lastName : null,
    //                 email: evt.body.email !== undefined ? evt.body.email : null,
    //                 updatedDate: now
    //             })
    //         };
    //     });
    //
    // router.route("/v2/customers/{customerId}")
    //     .method("DELETE")
    //     .handler(async evt => {
    //         const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    //         auth.requireIds("giftbitUserId");
    //         return {
    //             body: await deleteCustomer(auth.giftbitUserId, evt.pathParameters.customerId)
    //         };
    //     });

}

async function getValueStoreTemplates(userId: string, pagination: PaginationParams): Promise<{ valueStoreTemplates: ValueStoreTemplate[], pagination: Pagination }> {
    return withDbReadConnection(async conn => {
        const res: SqlSelectResponse<ValueStoreTemplate> = await conn.query(
            "SELECT * FROM ValueStoreTemplates WHERE userId = ? ORDER BY createdDate DESC LIMIT ?,?",
            [userId, pagination.offset, pagination.limit]
        );
        return {
            valueStoreTemplates: res,
            pagination: {
                count: res.length,
                limit: pagination.limit,
                maxLimit: pagination.maxLimit,
                offset: pagination.offset
            }
        };
    });
}

async function createValueStoreTemplate(valueStoreTemplate: ValueStoreTemplate): Promise<ValueStoreTemplate> {
    return withDbConnection<ValueStoreTemplate>(async conn => {
        try {
            await conn.query(
                "INSERT INTO ValueStoreTemplates (" +
                "userId, " +
                "valueStoreTemplateId, " +
                "valueStoreType, " +
                "initialValue, " +
                "minInitialValue, " +
                "maxInitialValue, " +
                "currency, " +
                "startDate, " +
                "endDate, " +
                "validityDurationDays, " +
                "uses, " +
                "redemptionRule, " +
                "valueRule, " +
                "createdDate, " +
                "updatedDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    valueStoreTemplate.userId,
                    valueStoreTemplate.valueStoreTemplateId,
                    valueStoreTemplate.valueStoreType,
                    valueStoreTemplate.initialValue,
                    valueStoreTemplate.minInitialValue,
                    valueStoreTemplate.maxInitialValue,
                    valueStoreTemplate.currency,
                    valueStoreTemplate.startDate,
                    valueStoreTemplate.endDate,
                    valueStoreTemplate.validityDurationDays,
                    valueStoreTemplate.uses,
                    valueStoreTemplate.redemptionRule,
                    valueStoreTemplate.valueRule,
                    valueStoreTemplate.createdDate,
                    valueStoreTemplate.updatedDate
                ]
            );
            return valueStoreTemplate;
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `ValueStoreTemplate with valueStoreTemplateId '${valueStoreTemplate.valueStoreTemplateId}' already exists.`);
            }
            throw err;
        }
    });
}

async function getValueStoreTemplate(userId: string, valueStoreTemplateId: string): Promise<ValueStoreTemplate> {
    return withDbConnectionSelectOne<ValueStoreTemplate>(
        "SELECT * FROM ValueStoreTemplates WHERE userId = ? AND valueStoreTemplateId = ?",
        [userId, valueStoreTemplateId]
    );
}

// async function updateCustomer(customer: Customer): Promise<Customer> {
//     return await withDbConnectionUpdateAndFetchOne<Customer>(
//         "UPDATE Customers SET firstName = ?, lastName = ?, email = ?, updatedDate = ? WHERE userId = ? AND customerId = ?",
//         [customer.firstName, customer.lastName, customer.email, customer.updatedDate, customer.userId, customer.customerId],
//         "SELECT * FROM Customers WHERE userId = ? AND customerId = ?",
//         [customer.userId, customer.customerId]
//     );
// }
//
// async function deleteCustomer(userId: string, customerId: string): Promise<{success: true}> {
//     await withDbConnectionDeleteOne(
//         "DELETE FROM Customers WHERE userId = ? AND customerId = ?",
//         [userId, customerId]
//     );
//     return {success: true};
// }

// const valueStoreTemplateSchema: jsonschema.Schema = {
//     type: "object",
//     properties: {
//         valueStoreTemplateId: {
//             type: "string",
//             maxLength: 255,
//             minLength: 1
//         }
//     },
//     required: ["valueStoreTemplateId"] // excluded "createdDate", "updatedDate" for same reason
// };
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

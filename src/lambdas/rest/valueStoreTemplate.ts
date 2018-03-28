import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {
    withDbConnection, withDbConnectionDeleteOne, withDbConnectionSelectOne, withDbConnectionUpdateAndFetchOne,
    withDbConnectionUpdateOne,
    withDbReadConnection
} from "../../dbUtils";
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

    router.route("/v2/valueStoreTemplates")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(valueStoreTemplateSchema);

            const now = new Date();
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

async function getValueStoreTemplates(userId: string, pagination: PaginationParams): Promise<{valueStoreTemplates: ValueStoreTemplate[], pagination: Pagination}> {
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
                "value, email, " +
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

const valueStoreTemplateSchema: jsonschema.Schema = {
    type: "object",
    properties: {
        userId: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        valueStoreTemplateId: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        valueStoreType: {
            type: ["string", "null"],
            maxLength: 255
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
        createdDate: {
            type: ["string"], // todo type?
            format: "date-time"
        },
        updatedDate: {
            type: ["string"], // todo type?
            format: "date-time"
        },
        startDate: {
            type: ["string", "null"], // todo type?
            format: "date-time"
        },
        endDate: {
            type: ["string", "null"], // todo type?
            format: "date-time"
        },
        uses: {
            type: ["integer", "null"],
        },
        redemptionRule: {
            type: ["string", "null"],
            maxLength: 65535
        },
        valueRule: {
            type: ["string", "null"],
            maxLength: 65535
        }
    },
    required: ["userId","valueStoreTemplateId", "currency"]
};

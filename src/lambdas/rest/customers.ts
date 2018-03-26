import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {
    withDbConnection, withDbConnectionDeleteOne, withDbConnectionSelectOne, withDbConnectionUpdateOne,
    withDbReadConnection
} from "../../dbUtils";
import {validateBody} from "../../restUtils";
import {Customer} from "../../model/Customer";
import {SqlSelectResponse} from "../../sqlResponses";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";

export function installCustomersRest(router: cassava.Router): void {
    router.route("/v2/customers")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getCustomers(auth.giftbitUserId, getPaginationParams(evt))
            };
        });

    router.route("/v2/customers")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            validateBody(evt, customerSchema);

            return {
                body: await createCustomer({
                    userId: auth.giftbitUserId,
                    customerId: evt.body.customerId,
                    firstName: evt.body.firstName !== undefined ? evt.body.firstName : null,
                    lastName: evt.body.lastName !== undefined ? evt.body.lastName : null,
                    email: evt.body.email !== undefined ? evt.body.email : null
                })
            };
        });

    router.route("/v2/customers/{customerId}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getCustomer(auth.giftbitUserId, evt.pathParameters.customerId)
            };
        });

    router.route("/v2/customers/{customerId}")
        .method("PUT")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            validateBody(evt, customerSchema);

            return {
                body: await updateCustomer({
                    userId: auth.giftbitUserId,
                    customerId: evt.pathParameters.customerId,
                    firstName: evt.body.firstName !== undefined ? evt.body.firstName : null,
                    lastName: evt.body.lastName !== undefined ? evt.body.lastName : null,
                    email: evt.body.email !== undefined ? evt.body.email : null
                })
            };
        });

    router.route("/v2/customers/{customerId}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteCustomer(auth.giftbitUserId, evt.pathParameters.customerId)
            };
        });
}

async function getCustomers(userId: string, pagination: PaginationParams): Promise<{customers: Customer[], pagination: Pagination}> {
    return withDbReadConnection(async conn => {
        const res: SqlSelectResponse<Customer> = await conn.query(
            "SELECT * FROM customers WHERE userId = ? ORDER BY customerId LIMIT ?,?",
            [userId, pagination.offset, pagination.limit]
        );
        return {
            customers: res,
            pagination: {
                count: res.length,
                limit: pagination.limit,
                maxLimit: pagination.maxLimit,
                offset: pagination.offset
            }
        };
    });
}

async function createCustomer(customer: Customer): Promise<Customer> {
    return withDbConnection<Customer>(async conn => {
        try {
            await conn.query(
                "INSERT INTO customers (userId, customerId, firstName, lastName, email) VALUES (?, ?, ?, ?, ?)",
                [customer.userId, customer.customerId, customer.firstName, customer.lastName, customer.email]
            );
            return customer;
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Customer with customerId '${customer.customerId}' already exists.`);
            }
            throw err;
        }
    });
}

async function getCustomer(userId: string, customerId: string): Promise<Customer> {
    return withDbConnectionSelectOne<Customer>(
        "SELECT * FROM customers WHERE userId = ? AND customerId = ?",
        [userId, customerId]
    );
}

async function updateCustomer(customer: Customer): Promise<Customer> {
    await withDbConnectionUpdateOne(
        "UPDATE customers SET firstName = ?, lastName = ?, email = ? WHERE userId = ? AND customerId = ?",
        [customer.firstName, customer.lastName, customer.email, customer.userId, customer.customerId]
    );
    return customer;
}

async function deleteCustomer(userId: string, customerId: string): Promise<{success: true}> {
    await withDbConnectionDeleteOne(
        "DELETE FROM customers WHERE userId = ? AND customerId = ?",
        [userId, customerId]
    );
    return {success: true};
}

const customerSchema: jsonschema.Schema = {
    type: "object",
    properties: {
        customerId: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        firstName: {
            type: ["string", "null"]
        },
        lastName: {
            type: ["string", "null"]
        },
        email: {
            type: ["string", "null"]
        }
    },
    required: ["customerId"]
};

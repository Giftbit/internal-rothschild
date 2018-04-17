import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {getKnexWrite, getKnexRead} from "../../dbUtils";
import {Customer, DbCustomer} from "../../model/Customer";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";

export function installCustomersRest(router: cassava.Router): void {
    router.route("/v2/customers")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getCustomers(auth, getPaginationParams(evt))
            };
        });

    router.route("/v2/customers")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(customerSchema);

            const now = new Date();
            now.setMilliseconds(0);
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createCustomer(auth, {
                    customerId: evt.body.customerId,
                    firstName: evt.body.firstName !== undefined ? evt.body.firstName : null,
                    lastName: evt.body.lastName !== undefined ? evt.body.lastName : null,
                    email: evt.body.email !== undefined ? evt.body.email : null,
                    metadata: evt.body.metadata !== undefined ? evt.body.metadata : null,
                    createdDate: now,
                    updatedDate: now
                })
            };
        });

    router.route("/v2/customers/{customerId}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getCustomer(auth, evt.pathParameters.customerId)
            };
        });

    router.route("/v2/customers/{customerId}")
        .method("PUT")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(customerSchema);

            const now = new Date();
            now.setMilliseconds(0);
            return {
                body: await updateCustomer(auth, {
                    customerId: evt.pathParameters.customerId,
                    firstName: evt.body.firstName !== undefined ? evt.body.firstName : null,
                    lastName: evt.body.lastName !== undefined ? evt.body.lastName : null,
                    email: evt.body.email !== undefined ? evt.body.email : null,
                    metadata: evt.body.metadata !== undefined ? evt.body.metadata : null,
                    updatedDate: now
                })
            };
        });

    router.route("/v2/customers/{customerId}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteCustomer(auth, evt.pathParameters.customerId)
            };
        });
}

// TODO this should be filterable by firstName, lastName, email (includes, ignore case)
export async function getCustomers(auth: giftbitRoutes.jwtauth.AuthorizationBadge, pagination: PaginationParams): Promise<{customers: Customer[], pagination: Pagination}> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbCustomer[] = await knex("Customers")
        .select()
        .where({
            userId: auth.giftbitUserId
        })
        .orderBy("customerId")
        .limit(pagination.limit)
        .offset(pagination.offset);
    return {
        customers: res.map(DbCustomer.toCustomer),
        pagination: {
            count: res.length,
            limit: pagination.limit,
            maxLimit: pagination.maxLimit,
            offset: pagination.offset
        }
    };
}

export async function createCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, customer: Customer): Promise<Customer> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        await knex("Customers")
            .insert(Customer.toDbCustomer(auth, customer));
        return customer;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Customer with customerId '${customer.customerId}' already exists.`);
        }
        throw err;
    }
}

export async function getCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, customerId: string): Promise<Customer> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbCustomer[] = await knex("Customers")
        .select()
        .where({
            userId: auth.giftbitUserId,
            customerId
        });
    if (res.length === 0) {
        throw new cassava.RestError(404);
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbCustomer.toCustomer(res[0]);
}

export async function updateCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, customer: Partial<Customer>): Promise<Customer> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("Customers")
        .where({
            userId: auth.giftbitUserId,
            customerId: customer.customerId
        })
        .update({
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            updatedDate: customer.updatedDate,
            metadata: JSON.stringify(customer.metadata)
        });
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
    }
    return getCustomer(auth, customer.customerId);
}

export async function deleteCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, customerId: string): Promise<{success: true}> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("Customers")
        .where({
            userId: auth.giftbitUserId,
            customerId
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

const customerSchema: jsonschema.Schema = {
    type: "object",
    properties: {
        customerId: {
            type: "string",
            maxLength: 255,
            minLength: 1
        },
        firstName: {
            type: ["string", "null"],
            maxLength: 255
        },
        lastName: {
            type: ["string", "null"],
            maxLength: 255
        },
        email: {
            type: ["string", "null"],
            maxLength: 320
        },
        metadata: {
            type: ["object", "null"]
        }
    },
    required: ["customerId"]
};

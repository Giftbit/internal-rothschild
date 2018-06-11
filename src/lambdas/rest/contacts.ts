import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Contact, DbContact} from "../../model/Contact";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {pick, pickOrDefault} from "../../pick";
import {csvSerializer} from "../../serializers";
import {filterAndPaginateQuery, nowInDbPrecision} from "../../dbUtils";
import {getKnexRead, getKnexWrite} from "../../dbUtils/connection";

export function installContactsRest(router: cassava.Router): void {
    router.route("/v2/contacts")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            const res = await getContacts(auth, evt.queryStringParameters, Pagination.getPaginationParams(evt));
            return {
                headers: Pagination.toHeaders(evt, res.pagination),
                body: res.contacts
            };
        });

    router.route("/v2/contacts")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(contactSchema);

            const now = nowInDbPrecision();
            const contact = {
                ...pickOrDefault(evt.body, {
                    id: "",
                    firstName: null,
                    lastName: null,
                    email: null,
                    metadata: null
                }),
                createdDate: now,
                updatedDate: now
            };
            return {
                statusCode: cassava.httpStatusCode.success.CREATED,
                body: await createContact(auth, contact)
            };
        });

    router.route("/v2/contacts/{id}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getContact(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/contacts/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            evt.validateBody(contactUpdateSchema);

            if (evt.body.id && evt.body.id !== evt.pathParameters.id) {
                throw new giftbitRoutes.GiftbitRestError(422, `The body id '${evt.body.id}' does not match the path id '${evt.pathParameters.id}'.  The id cannot be updated.`);
            }

            const now = nowInDbPrecision();
            const contact = {
                ...pick<Contact>(evt.body, "firstName", "lastName", "email", "metadata"),
                updatedDate: now
            };
            return {
                body: await updateContact(auth, evt.pathParameters.id, contact)
            };
        });

    router.route("/v2/contacts/{id}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteContact(auth, evt.pathParameters.id)
            };
        });
}

export async function getContacts(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: {[key: string]: string}, pagination: PaginationParams): Promise<{ contacts: Contact[], pagination: Pagination }> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res = await filterAndPaginateQuery<DbContact>(
        knex("Contacts")
            .where({
                userId: auth.giftbitUserId
            }),
        filterParams,
        {
            properties: {
                "id": {
                    type: "string",
                    operators: ["eq", "in"]
                },
                "firstName": {
                    type: "string"
                },
                "lastName": {
                    type: "string"
                },
                "email": {
                    type: "string"
                }
            }
        },
        pagination
    );
    return {
        contacts: res.body.map(DbContact.toContact),
        pagination: res.pagination
    };
}

export async function createContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contact: Contact): Promise<Contact> {
    auth.requireIds("giftbitUserId");

    try {
        const knex = await getKnexWrite();
        await knex("Contacts")
            .insert(Contact.toDbContact(auth, contact));
        return contact;
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact with id '${contact.id}' already exists.`);
        }
        throw err;
    }
}

export async function getContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<Contact> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexRead();
    const res: DbContact[] = await knex("Contacts")
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
    return DbContact.toContact(res[0]);
}

export async function updateContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, contact: Partial<Contact>): Promise<Contact> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res = await knex("Contacts")
        .where({
            userId: auth.giftbitUserId,
            id: id
        })
        .update(Contact.toDbContactUpdate(contact));
    if (res[0] === 0) {
        throw new cassava.RestError(404);
    }
    if (res[0] > 1) {
        throw new Error(`Illegal UPDATE query.  Updated ${res.length} values.`);
    }
    return {
        ...await getContact(auth, id),
        ...contact
    };
}

export async function deleteContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<{ success: true }> {
    auth.requireIds("giftbitUserId");

    const knex = await getKnexWrite();
    const res: [number] = await knex("Contacts")
        .where({
            userId: auth.giftbitUserId,
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

const contactSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 32,
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
    required: ["id"]
};

const contactUpdateSchema: jsonschema.Schema = {
    ...contactSchema,
    required: []
};


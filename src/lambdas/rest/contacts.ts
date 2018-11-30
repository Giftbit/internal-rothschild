import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import * as jsonschema from "jsonschema";
import {Contact, DbContact} from "../../model/Contact";
import {Pagination, PaginationParams} from "../../model/Pagination";
import {pick, pickOrDefault} from "../../utils/pick";
import {csvSerializer} from "../../serializers";
import {filterAndPaginateQuery, nowInDbPrecision} from "../../utils/dbUtils";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import * as knex from "knex";

export function installContactsRest(router: cassava.Router): void {
    router.route("/v2/contacts")
        .method("GET")
        .serializers({
            "application/json": cassava.serializers.jsonSerializer,
            "text/csv": csvSerializer
        })
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            auth.requireScopes("lightrailV2:contacts:list");

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
            auth.requireIds("userId", "teamMemberId");
            if (auth.hasScope("lightrailV2:contacts:create:self") && evt.body && auth.contactId === evt.body.id) {
                // Badge is signed specifically to create this Contact.
            } else {
                auth.requireScopes("lightrailV2:contacts:create");
            }
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
                updatedDate: now,
                createdBy: auth.teamMemberId ? auth.teamMemberId : auth.userId,
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
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:contacts:read:self") && auth.contactId === evt.pathParameters.id) {
                // Badge is signed specifically to read this Contact.
            } else {
                auth.requireScopes("lightrailV2:contacts:read");
            }

            return {
                body: await getContact(auth, evt.pathParameters.id)
            };
        });

    router.route("/v2/contacts/{id}")
        .method("PATCH")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:contacts:update:self") && auth.contactId === evt.pathParameters.id) {
                // Badge is signed specifically to update this Contact.
            } else {
                auth.requireScopes("lightrailV2:contacts:update");
            }

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
            auth.requireIds("userId");
            if (auth.hasScope("lightrailV2:contacts:delete:self") && auth.contactId === evt.pathParameters.id) {
                // Badge is signed specifically to delete this Contact.
            } else {
                auth.requireScopes("lightrailV2:contacts:delete");
            }

            return {
                body: await deleteContact(auth, evt.pathParameters.id)
            };
        });
}

export async function getContacts(auth: giftbitRoutes.jwtauth.AuthorizationBadge, filterParams: { [key: string]: string }, pagination: PaginationParams): Promise<{ contacts: Contact[], pagination: Pagination }> {
    auth.requireIds("userId");

    const knex = await getKnexRead();

    let query: knex.QueryBuilder = knex("Contacts")
        .select("Contacts.*")
        .where("Contacts.userId", "=", auth.userId);
    const valueId = filterParams["valueId"];
    if (valueId) {

        // join ContactValues
        query.leftJoin("ContactValues", {
            "Contacts.id": "ContactValues.contactId",
            "Contacts.userId": "ContactValues.userId"
        });

        // also join Values
        query.leftJoin("Values", {
            "Contacts.id": "Values.contactId",
            "Contacts.userId": "Values.userId"
        });

        query.andWhere(q => {
            q.where("ContactValues.valueId", "=", valueId);
            q.orWhere("Values.id", "=", valueId);
            return q;
        });

        query.groupBy("Contacts.id");
    }
    const res = await filterAndPaginateQuery<DbContact>(
        query,
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
                },
                "createdDate": {
                    type: "Date",
                    operators: ["eq", "gt", "gte", "lt", "lte", "ne"]
                },
            },
            tableName: "Contacts"
        },
        pagination
    );
    return {
        contacts: res.body.map(DbContact.toContact),
        pagination: res.pagination
    };
}

export async function createContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, contact: Contact): Promise<Contact> {
    auth.requireIds("userId", "teamMemberId");

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
    auth.requireIds("userId");

    const knex = await getKnexRead();
    const res: DbContact[] = await knex("Contacts")
        .select()
        .where({
            userId: auth.userId,
            id: id
        });
    if (res.length === 0) {
        throw new giftbitRoutes.GiftbitRestError(404, `Contact with id '${id}' not found.`, "ContactNotFound");
    }
    if (res.length > 1) {
        throw new Error(`Illegal SELECT query.  Returned ${res.length} values.`);
    }
    return DbContact.toContact(res[0]);
}

export async function updateContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string, contactUpdates: Partial<Contact>): Promise<Contact> {
    auth.requireIds("userId");

    const knex = await getKnexWrite();
    return await knex.transaction(async trx => {
        // Get the master version of the Contact and lock it.
        const selectContactRes: DbContact[] = await trx("Contacts")
            .select()
            .where({
                userId: auth.userId,
                id: id
            })
            .forUpdate();
        if (selectContactRes.length === 0) {
            throw new giftbitRoutes.GiftbitRestError(404, `Contact with id '${id}' not found.`, "ContactNotFound");
        }
        if (selectContactRes.length > 1) {
            throw new Error(`Illegal SELECT query.  Returned ${selectContactRes.length} values.`);
        }
        const existingContact = DbContact.toContact(selectContactRes[0]);
        const updatedContact = {
            ...existingContact,
            ...contactUpdates
        };

        const patchRes: number = await trx("Contacts")
            .where({
                userId: auth.userId,
                id: id
            })
            .update(Contact.toDbContactUpdate(contactUpdates));
        if (patchRes === 0) {
            throw new cassava.RestError(404);
        }
        if (patchRes > 1) {
            throw new Error(`Illegal UPDATE query.  Updated ${patchRes} values.`);
        }
        return updatedContact;
    });
}

export async function deleteContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, id: string): Promise<{ success: true }> {
    auth.requireIds("userId");

    try {
        const knex = await getKnexWrite();
        const res: number = await knex("Contacts")
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
            throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact '${id}' is in use.`, "ContactInUse");
        }
        throw err;
    }
}

const contactSchema: jsonschema.Schema = {
    type: "object",
    additionalProperties: false,
    properties: {
        id: {
            type: "string",
            maxLength: 64,
            minLength: 1,
            pattern: "^[ -~]*$"
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

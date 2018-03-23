import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {
    withDbConnection, withDbConnectionSelectOne, withDbConnectionUpdateOne,
    withDbReadConnection
} from "../../dbUtils";
import {Contact} from "../../model/Contact";
import {SqlSelectResponse} from "../../sqlResponses";
import {getPaginationParams, Pagination, PaginationParams} from "../../model/Pagination";

export function installContactsRest(router: cassava.Router): void {
    router.route("/v2/contacts")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getContacts(auth.giftbitUserId, getPaginationParams(evt))
            };
        });

    router.route("/v2/contacts")
        .method("POST")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            requireBodyMember(evt, "contactId", {type: "string", required: true, nullable: false});
            requireBodyMember(evt, "firstName", {type: "string"});
            requireBodyMember(evt, "lastName", {type: "string"});
            requireBodyMember(evt, "email", {type: "string"});

            return {
                body: await createContact({
                    ...evt.body,
                    platformUserId: auth.giftbitUserId
                })
            };
        });

    router.route("/v2/contacts/{contactId}")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getContact(auth.giftbitUserId, evt.pathParameters.contactId)
            };
        });

    router.route("/v2/contacts/{contactId}")
        .method("PUT")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");

            requireBodyMember(evt, "contactId", {type: "string", nullable: false});
            requireBodyMember(evt, "firstName", {type: "string"});
            requireBodyMember(evt, "lastName", {type: "string"});
            requireBodyMember(evt, "email", {type: "string"});

            return {
                body: await updateContact({
                    ...evt.body,
                    platformUserId: auth.giftbitUserId,
                    contactId: evt.pathParameters.contactId
                })
            };
        });

    router.route("/v2/contacts/{contactId}")
        .method("DELETE")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await deleteContact(auth.giftbitUserId, evt.pathParameters.contactId)
            };
        });
}

async function getContacts(platformUserId: string, pagination: PaginationParams): Promise<{contacts: Contact[], pagination: Pagination}> {
    return withDbReadConnection(async conn => {
        const res: SqlSelectResponse<Contact> = await conn.query(
            "SELECT * FROM contacts WHERE platformUserId = ? ORDER BY contactId LIMIT ?,?",
            [platformUserId, pagination.offset, pagination.limit]
        );
        return {
            contacts: res,
            pagination: {
                count: res.length,
                limit: pagination.limit,
                maxLimit: pagination.maxLimit,
                offset: pagination.offset,
                totalCount: res.length
            }
        };
    });
}

export async function createContact(contact: Contact): Promise<Contact> {
    if (!contact.contactId) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "contactId must be set");
    }
    if (contact.contactId.length > 255) {
        throw new cassava.RestError(cassava.httpStatusCode.clientError.BAD_REQUEST, "contactId too long");
    }

    return withDbConnection<Contact>(async conn => {
        try {
            await conn.query(
                "INSERT INTO contacts (platformUserId, contactId, firstName, lastName, email) VALUES (?, ?, ?, ?, ?)",
                [contact.platformUserId, contact.contactId, contact.firstName, contact.lastName, contact.email]
            );
            return contact;
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") {
                throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact with contactId '${contact.contactId}' already exists.`);
            }
            throw err;
        }
    });
}

export async function getContact(platformUserId: string, contactId: string): Promise<Contact> {
    return withDbConnectionSelectOne<Contact>(
        "SELECT * FROM contacts WHERE platformUserId = ? AND contactId = ?",
        [platformUserId, contactId]
    );
}

export async function updateContact(contact: Contact): Promise<Contact> {
    await withDbConnectionUpdateOne(
        "UPDATE contacts SET firstName = ?, lastName = ?, email = ? WHERE platformUserId = ? AND contactId = ?",
        [contact.firstName, contact.lastName, contact.email, contact.platformUserId, contact.contactId]
    );
    return contact;
}

export async function deleteContact(platformUserId: string, contactId: string): Promise<any> {
    throw new cassava.RestError(500, "Not implemented yet.");
}

function requireBodyMember(evt: cassava.RouterEvent, member: string, conditions: BodyMemberConditions): void {
    if (typeof evt.body !== "object") {
        throw new cassava.RestError(400, "The body must be a JSON object.");
    }
    if (!evt.body.hasOwnProperty(member)) {
        if (conditions.required) {
            throw new cassava.RestError(400, `Required body value '${member}' is not set.`);
        }
    } else if (evt.body[member] === null) {
        if (conditions.nullable === false) {
            throw new cassava.RestError(400, `Body value '${member}' must not be null.`);
        }
    } else {
        if (conditions.type && typeof evt.body[member] !== conditions.type) {
            throw new cassava.RestError(400, `Body value '${member}' must be of type ${conditions.type}.`);
        }
    }
}

interface BodyMemberConditions {
    required?: boolean;
    nullable?: boolean;
    type?: "string" | "number" | "boolean" | "object";
}

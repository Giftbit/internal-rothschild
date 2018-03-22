import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getDbConnection} from "../../dbUtils";
import {Contact} from "../../model/Contact";
import {SqlInsertResponse, SqlUpdateResponse} from "../../sqlResponses";

export function installContactsRest(router: cassava.Router): void {
    router.route("/v2/contacts")
        .method("GET")
        .handler(async evt => {
            const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
            auth.requireIds("giftbitUserId");
            return {
                body: await getContacts(auth.giftbitUserId)
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

async function getContacts(platformUserId: string): Promise<any> {
    const conn = await getDbConnection();

    try {
        const res = await conn.query(
            // "SELECT * FROM contacts WHERE platformUserId = ?",
            // [platformUserId]
            "SELECT * FROM contacts"
        );
        conn.end();

        return {
            contacts: res,
            platformUserId,
            pagination: {
                count: 1,
                limit: 100,
                maxLimit: 1000,
                offset: 0,
                totalCount: 1
            }
        };
    } catch (err) {
        conn.end();
        throw err;
    }
}

export async function createContact(contact: Contact): Promise<any> {
    const conn = await getDbConnection();

    try {
        const res: SqlInsertResponse = await conn.query(
            "INSERT INTO contacts (platformUserId, contactId, firstName, lastName, email) VALUES (?, ?, ?, ?, ?)",
            [contact.platformUserId, contact.contactId, contact.firstName, contact.lastName, contact.email]
        );
        conn.end();

        return {
            body: {
                contact,
                res
            }
        };
    } catch (err) {
        conn.end();

        return {
            contact,
            err
        };
        // if (err.code === "ER_DUP_ENTRY") {
        //     throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact with contactId '${contact.contactId}' already exists.`);
        // }
        // throw err;
    }
}

export async function getContact(platformUserId: string, contactId: string): Promise<any> {
    const conn = await getDbConnection();

    try {
        const res = await conn.query(
            "SELECT * FROM contacts WHERE platformUserId = ? AND contactId = ?",
            [platformUserId, contactId]
        );
        conn.end();

        return {
            res,
            platformUserId,
            contactId
        };
    } catch (err) {
        conn.end();
        return {
            platformUserId,
            contactId,
            err
        };
        // throw err;
    }
}

export async function updateContact(contact: Contact): Promise<any> {
    const conn = await getDbConnection();

    try {
        const res: SqlUpdateResponse = await conn.query(
            "UPDATE contacts SET firstName = ?, lastName = ?, email = ? WHERE platformUserId = ? AND contactId = ?",
            [contact.firstName, contact.lastName, contact.email, contact.platformUserId, contact.contactId]
        );
        conn.end();

        return {
            contact,
            res: res
        };
    } catch (err) {
        conn.end();
        return {
            contact,
            error: err
        };
    }
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

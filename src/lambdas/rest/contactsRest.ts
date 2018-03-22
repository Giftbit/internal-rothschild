import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {getDbConnection} from "../../dbUtils";
import {Contact} from "../../model/Contact";

export async function getContacts(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    return {
        body: {
            contacts: [
                {
                    contactId: "abcd",
                    firstName: "First",
                    lastName: "Last",
                    email: "email@example.com"
                }
            ],
            pagination: {
                count: 1,
                limit: 100,
                maxLimit: 1000,
                offset: 0,
                totalCount: 1
            }
        }
    };
}

export async function createContact(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    auth.requireIds("giftbitUserId");

    requireBodyMember(evt, "contactId", {type: "string", required: true, nullable: false});
    requireBodyMember(evt, "firstName", {type: "string"});
    requireBodyMember(evt, "lastName", {type: "string"});
    requireBodyMember(evt, "email", {type: "string"});

    const conn = await getDbConnection();

    try {
        const res = await conn.query(
            "INSERT INTO contacts (platformUserId, contactId, firstName, lastName, email) VALUES (?, ?, ?, ?, ?)",
            [auth.giftbitUserId, evt.body.contactId, evt.body.firstName, evt.body.lastName, evt.body.email]
        );

        conn.end();

        // const contact: Contact = {
        //     platformUserId: auth.giftbitUserId,
        //     contactId: evt.body.contactId,
        //     firstName: evt.body.firstName,
        //     lastName: evt.body.lastName,
        //     email: evt.body.email
        // };
        return {
            body: {
                res
            }
        };
    } catch (err) {
        conn.end();

        if (err.code === "ER_DUP_ENTRY") {
            throw new cassava.RestError(cassava.httpStatusCode.clientError.CONFLICT, `Contact with contactId '${evt.body.contactId}' already exists.`);
        }
        throw err;
    }
}

export async function getContact(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    auth.requireIds("giftbitUserId");

    const conn = await getDbConnection();

    try {
        const res = await conn.query(
            "SELECT * FROM contacts WHERE platformUserId = ? AND contactId = ?",
            [auth.giftbitUserId, evt.pathParameters["contactId"]]
        );

        conn.end();

        return {
            body: {
                res: res
            }
        };
    } catch (err) {
        conn.end();
        return {
            body: {
                error: err
            }
        };
    }
}

export async function updateContact(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = evt.meta["auth"];
    auth.requireIds("giftbitUserId");

    requireBodyMember(evt, "firstName", {type: "string"});
    requireBodyMember(evt, "lastName", {type: "string"});
    requireBodyMember(evt, "email", {type: "string"});

    const conn = await getDbConnection();

    try {
        const res = await conn.query(
            "UPDATE contacts SET firstName = ?, lastName = ?, email = ? WHERE platformUserId = ? AND contactId = ?",
            [evt.body.firstName, evt.body.lastName, evt.body.email, auth.giftbitUserId, evt.pathParameters["contactId"]]
        );

        conn.end();

        return {
            body: {
                res: res
            }
        };
    } catch (err) {
        conn.end();
        return {
            body: {
                error: err
            }
        };
    }
}

export async function deleteContact(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
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

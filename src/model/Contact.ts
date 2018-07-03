import * as giftbitRoutes from "giftbit-cassava-routes";
import {pickDefined} from "../utils/pick";

export interface Contact {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
}

export namespace Contact {
    export function toDbContact(auth: giftbitRoutes.jwtauth.AuthorizationBadge, c: Contact): DbContact {
        return {
            userId: auth.giftbitUserId,
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            metadata: JSON.stringify(c.metadata),
            createdDate: c.createdDate,
            updatedDate: c.updatedDate
        };
    }

    export function toDbContactUpdate(c: Partial<Contact>): Partial<DbContact> {
        return pickDefined({
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            metadata: JSON.stringify(c.metadata),
            updatedDate: c.updatedDate
        });
    }
}

export interface DbContact {
    userId: string;
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    metadata: string;
    createdDate: Date;
    updatedDate: Date;
}

export namespace DbContact {
    export function toContact(c: DbContact): Contact {
        return {
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            metadata: JSON.parse(c.metadata),
            createdDate: c.createdDate,
            updatedDate: c.updatedDate
        };
    }
}

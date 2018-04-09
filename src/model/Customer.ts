import * as giftbitRoutes from "giftbit-cassava-routes";

export interface Customer {
    customerId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    metadata: object | null;
    createdDate: Date;
    updatedDate: Date;
}

export namespace Customer {
    export function toDbCustomer(auth: giftbitRoutes.jwtauth.AuthorizationBadge, c: Customer): DbCustomer {
        return {
            userId: auth.giftbitUserId,
            customerId: c.customerId,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            metadata: JSON.stringify(c.metadata),
            createdDate: c.createdDate,
            updatedDate: c.updatedDate
        };
    }
}

export interface DbCustomer {
    userId: string;
    customerId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    metadata: string;
    createdDate: Date;
    updatedDate: Date;
}

export namespace DbCustomer {
    export function toCustomer(c: DbCustomer): Customer {
        return {
            customerId: c.customerId,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            metadata: JSON.parse(c.metadata),
            createdDate: c.createdDate,
            updatedDate: c.updatedDate
        };
    }
}

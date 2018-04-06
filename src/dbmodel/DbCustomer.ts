import {Customer} from "../model/Customer";

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

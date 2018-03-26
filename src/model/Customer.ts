import {Schema} from "jsonschema";

export interface Customer {
    userId: string;
    customerId: string;
    firstName?: string;
    lastName?: string;
    email?: string;
}

export const customerSchema implements Schema = {
    type: "object",
    properties: {
        customerId: {
            type: "string"
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

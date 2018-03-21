import * as cassava from "cassava";

export async function getContact(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    return {
        body: {
            contactId: "abcd",
            firstName: "First",
            lastName: "Last",
            email: "email@example.com"
        }
    };
}

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

export async function putContact(evt: cassava.RouterEvent): Promise<cassava.RouterResponse> {
    return {
        body: {
            contactId: "abcd",
            firstName: "First",
            lastName: "Last",
            email: "email@example.com"
        }
    };
}

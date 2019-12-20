import {LightrailEvent} from "./LightrailEvent";
import {DbContact} from "../../../model/Contact";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";

export async function getContactCreatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Contacts")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbContact>[])
        .map(row => {
            const newContact = row.after as DbContact;
            return {
                specversion: "1.0",
                type: "lightrail.contact.created",
                source: "/lightrail/rothschild",
                id: `contact-created-${newContact.id}`, // TODO what if it is created, deleted and created again?
                time: newContact.createdDate,
                userId: newContact.userId,
                datacontenttype: "application/json",
                data: {
                    newContact: DbContact.toContact(newContact)
                }
            };
        });
}

export async function getContactDeletedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "DELETE" && s.table === "Contacts")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbContact>[])
        .map(row => {
            const oldContact = row.before as DbContact;
            return {
                specversion: "1.0",
                type: "lightrail.contact.deleted",
                source: "/lightrail/rothschild",
                id: `contact-deleted-${oldContact.id}`,
                time: new Date(),
                userId: oldContact.userId,
                datacontenttype: "application/json",
                data: {
                    oldContact: DbContact.toContact(oldContact)
                }
            };
        });
}

export async function getContactUpdatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "UPDATE" && s.table === "Contacts")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbContact>[])
        .map(row => {
            const oldContact = row.before as DbContact;
            const newContact = row.after as DbContact;
            return {
                specversion: "1.0",
                type: "lightrail.contact.updated",
                source: "/lightrail/rothschild",
                id: `contact-updated-${oldContact.id}-${newContact.updatedDate.toISOString()}`,
                time: newContact.updatedDate,
                userId: newContact.userId,
                datacontenttype: "application/json",
                data: {
                    oldContact: DbContact.toContact(oldContact),
                    newContact: DbContact.toContact(newContact)
                }
            };
        });
}

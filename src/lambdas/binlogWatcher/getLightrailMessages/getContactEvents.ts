import {LightrailEvent} from "../LightrailEvent";
import {DbContact} from "../../../model/Contact";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";

export async function getContactCreatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Contacts")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbContact>[])
        .map(row => {
            const newContact = row.after as DbContact;
            return {
                type: "lightrail.contact.created",
                service: "rothschild",
                userId: newContact.userId,
                createdDate: new Date().toISOString(),
                payload: {
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
                type: "lightrail.contact.deleted",
                service: "rothschild",
                userId: oldContact.userId,
                createdDate: new Date().toISOString(),
                payload: {
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
                type: "lightrail.contact.updated",
                service: "rothschild",
                userId: newContact.userId,
                createdDate: new Date().toISOString(),
                payload: {
                    oldContact: DbContact.toContact(oldContact),
                    newContact: DbContact.toContact(newContact)
                }
            };
        });
}

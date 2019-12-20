import {LightrailEvent} from "./LightrailEvent";
import {DbValue} from "../../../model/Value";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";

export async function getValueCreatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Values")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbValue>[])
        .map(row => {
            const newValue = row.after as DbValue;
            return {
                specversion: "1.0",
                type: "lightrail.value.created",
                source: "/lightrail/rothschild",
                id: `value-created-${newValue.id}`,
                time: newValue.createdDate,
                userId: newValue.userId,
                datacontenttype: "application/json",
                data: {
                    newValue: DbValue.toValue(newValue, false)
                }
            };
        });
}

export async function getValueDeletedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "DELETE" && s.table === "Values")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbValue>[])
        .map(row => {
            const oldValue = row.before as DbValue;
            return {
                specversion: "1.0",
                type: "lightrail.value.deleted",
                source: "/lightrail/rothschild",
                id: `value-deleted-${oldValue.id}`,
                time: new Date(),
                userId: oldValue.userId,
                datacontenttype: "application/json",
                data: {
                    oldValue: DbValue.toValue(oldValue, false)
                }
            };
        });
}

export async function getValueUpdatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "UPDATE" && s.table === "Values")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbValue>[])
        .map(row => {
            const oldValue = row.before as DbValue;
            const newValue = row.after as DbValue;
            return {
                specversion: "1.0",
                type: "lightrail.value.updated",
                source: "/lightrail/rothschild",
                id: `value-updated-${oldValue.id}-${newValue.updatedDate.toISOString()}`,
                time: newValue.updatedDate,
                userId: oldValue.userId,
                datacontenttype: "application/json",
                data: {
                    oldValue: DbValue.toValue(oldValue, false),
                    newValue: DbValue.toValue(newValue, false)
                }
            };
        });
}

import {BinlogTransaction} from "../BinlogTransaction";
import {LightrailMessage} from "../LightrailMessage";
import {DbValue} from "../../../model/Value";

export async function getValueCreatedMessages(tx: BinlogTransaction): Promise<LightrailMessage[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Values")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbValue>[])
        .map(row => {
            const newValue = row.after as DbValue;
            return {
                type: "lightrail.value.created",
                service: "rothschild",
                userId: newValue.userId,
                createdDate: new Date().toISOString(),
                payload: {
                    newValue: DbValue.toValue(newValue, false)
                }
            };
        });
}

export async function getValueDeletedMessages(tx: BinlogTransaction): Promise<LightrailMessage[]> {
    return tx.statements
        .filter(s => s.type === "DELETE" && s.table === "Values")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbValue>[])
        .map(row => {
            const oldValue = row.before as DbValue;
            return {
                type: "lightrail.value.deleted",
                service: "rothschild",
                userId: oldValue.userId,
                createdDate: new Date().toISOString(),
                payload: {
                    oldValue: DbValue.toValue(oldValue, false)
                }
            };
        });
}

export async function getValueUpdatedMessages(tx: BinlogTransaction): Promise<LightrailMessage[]> {
    return tx.statements
        .filter(s => s.type === "UPDATE" && s.table === "Values")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbValue>[])
        .map(row => {
            const oldValue = row.before as DbValue;
            const newValue = row.after as DbValue;
            return {
                type: "lightrail.value.updated",
                service: "rothschild",
                userId: oldValue.userId,
                createdDate: new Date().toISOString(),
                payload: {
                    oldValue: DbValue.toValue(oldValue, false),
                    newValue: DbValue.toValue(newValue, false)
                }
            };
        });
}

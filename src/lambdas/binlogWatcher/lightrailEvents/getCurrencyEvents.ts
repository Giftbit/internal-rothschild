import {LightrailEvent} from "./LightrailEvent";
import {DbCurrency} from "../../../model/Currency";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";
import {generateLightrailEventId} from "./generateEventId";

export async function getCurrencyCreatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Currencies")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbCurrency>[])
        .map(row => {
            const newCurrency = row.after as DbCurrency;
            return {
                specversion: "1.0",
                type: "lightrail.currency.created",
                source: "/lightrail/rothschild",
                id: generateLightrailEventId("lightrail.currency.created", newCurrency.userId, newCurrency.code, newCurrency.createdDate.getTime()),
                time: newCurrency.createdDate,
                userId: newCurrency.userId,
                datacontenttype: "application/json",
                data: {
                    newCurrency: DbCurrency.toCurrency(newCurrency)
                }
            };
        });
}

export async function getCurrencyDeletedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "DELETE" && s.table === "Currencies")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbCurrency>[])
        .map(row => {
            const oldCurrency = row.before as DbCurrency;
            return {
                specversion: "1.0",
                type: "lightrail.currency.deleted",
                source: "/lightrail/rothschild",
                id: generateLightrailEventId("lightrail.currency.deleted", oldCurrency.userId, oldCurrency.code, oldCurrency.createdDate.getTime()),
                time: new Date(),
                userId: oldCurrency.userId,
                datacontenttype: "application/json",
                data: {
                    oldCurrency: DbCurrency.toCurrency(oldCurrency)
                }
            };
        });
}

export async function getCurrencyUpdatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "UPDATE" && s.table === "Currencies")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbCurrency>[])
        .map(row => {
            const oldCurrency = row.before as DbCurrency;
            const newCurrency = row.after as DbCurrency;
            return {
                specversion: "1.0",
                type: "lightrail.currency.updated",
                source: "/lightrail/rothschild",
                id: generateLightrailEventId("lightrail.currency.updated", newCurrency.userId, newCurrency.code, newCurrency.updatedDate.getTime()),
                time: newCurrency.updatedDate,
                userId: newCurrency.userId,
                datacontenttype: "application/json",
                data: {
                    oldCurrency: DbCurrency.toCurrency(oldCurrency),
                    newCurrency: DbCurrency.toCurrency(newCurrency)
                }
            };
        });
}

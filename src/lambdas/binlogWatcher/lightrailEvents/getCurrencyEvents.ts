import {LightrailEvent} from "./LightrailEvent";
import {DbCurrency} from "../../../model/Currency";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";

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
                id: `currency-created-${newCurrency.code}`, // TODO what if it is created, deleted and created again?
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
                id: `currency-deleted-${oldCurrency.code}`,
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
                id: `currency-updated-${oldCurrency.code}-${newCurrency.updatedDate.toISOString()}`,
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

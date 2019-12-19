import {LightrailEvent} from "../LightrailEvent";
import {DbCurrency} from "../../../model/Currency";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";

export async function getCurrencyCreatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Currencies")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbCurrency>[])
        .map(row => {
            const newCurrency = row.after as DbCurrency;
            return {
                type: "lightrail.currency.created",
                service: "rothschild",
                userId: newCurrency.userId,
                createdDate: new Date().toISOString(),
                payload: {
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
                type: "lightrail.currency.deleted",
                service: "rothschild",
                userId: oldCurrency.userId,
                createdDate: new Date().toISOString(),
                payload: {
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
                type: "lightrail.currency.updated",
                service: "rothschild",
                userId: newCurrency.userId,
                createdDate: new Date().toISOString(),
                payload: {
                    oldCurrency: DbCurrency.toCurrency(oldCurrency),
                    newCurrency: DbCurrency.toCurrency(newCurrency)
                }
            };
        });
}

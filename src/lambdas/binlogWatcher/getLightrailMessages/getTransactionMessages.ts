import {LightrailMessage} from "../LightrailMessage";
import {
    DbTransaction,
    InternalDbTransactionStep,
    LightrailDbTransactionStep,
    StripeDbTransactionStep
} from "../../../model/Transaction";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";

export async function getTransactionCreatedMessages(tx: BinlogTransaction): Promise<LightrailMessage[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Transactions")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbTransaction>[])
        .map(row => {
            const dbTransaction = row.after as DbTransaction;

            const dbLightrailTransactionSteps = tx.statements
                .filter(s => s.type === "INSERT" && s.table === "LightrailTransactionSteps")
                .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<LightrailDbTransactionStep>[])
                .filter(row => row.after.userId === dbTransaction.userId && row.after.transactionId === dbTransaction.id)
                .map(row => row.after);
            const dbStripeTransactionSteps = tx.statements
                .filter(s => s.type === "INSERT" && s.table === "StripeTransactionSteps")
                .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<StripeDbTransactionStep>[])
                .filter(row => row.after.userId === dbTransaction.userId && row.after.transactionId === dbTransaction.id)
                .map(row => row.after);
            const dbInternalTransactionSteps = tx.statements
                .filter(s => s.type === "INSERT" && s.table === "InternalTransactionSteps")
                .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<InternalDbTransactionStep>[])
                .filter(row => row.after.userId === dbTransaction.userId && row.after.transactionId === dbTransaction.id)
                .map(row => row.after);

            return {
                type: "lightrail.transaction.created",
                service: "rothschild",
                userId: dbTransaction.userId,
                createdDate: new Date().toISOString(),
                payload: {
                    newTransaction: DbTransaction.toTransaction(dbTransaction, [...dbLightrailTransactionSteps, ...dbStripeTransactionSteps, ...dbInternalTransactionSteps])
                }
            };
        });
}

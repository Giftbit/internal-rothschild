import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";
import {LightrailEvent} from "./LightrailEvent";
import {DbProgram} from "../../../model/Program";
import {generateLightrailEventId} from "./generateEventId";

export async function getProgramCreatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "INSERT" && s.table === "Programs")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbProgram>[])
        .map(row => {
            const newProgram = row.after as DbProgram;
            return {
                specversion: "1.0",
                type: "lightrail.program.created",
                source: "/lightrail/rothschild",
                id: generateLightrailEventId("lightrail.program.created", newProgram.userId, newProgram.id, newProgram.updatedDate.getTime()),
                time: newProgram.createdDate,
                userid: newProgram.userId,
                datacontenttype: "application/json",
                data: {
                    newProgram: DbProgram.toProgram(newProgram)
                }
            };
        });
}

export async function getProgramDeletedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "DELETE" && s.table === "Programs")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbProgram>[])
        .map(row => {
            const oldProgram = row.before as DbProgram;
            return {
                specversion: "1.0",
                type: "lightrail.program.deleted",
                source: "/lightrail/rothschild",
                id: generateLightrailEventId("lightrail.program.deleted", oldProgram.userId, oldProgram.id, oldProgram.createdDate.getTime()),
                time: new Date(),
                userid: oldProgram.userId,
                datacontenttype: "application/json",
                data: {
                    oldProgram: DbProgram.toProgram(oldProgram)
                }
            };
        });
}


export async function getProgramUpdatedEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    return tx.statements
        .filter(s => s.type === "UPDATE" && s.table === "Programs")
        .reduce((res, s) => [...res, ...s.affectedRows], [] as BinlogTransaction.AffectedRow<DbProgram>[])
        .map(row => {
            const oldProgram = row.before as DbProgram;
            const newProgram = row.after as DbProgram;
            return {
                specversion: "1.0",
                type: "lightrail.program.updated",
                source: "/lightrail/rothschild",
                id: generateLightrailEventId("lightrail.program.updated", newProgram.userId, newProgram.id, newProgram.updatedDate.getTime()),
                time: new Date(),
                userid: oldProgram.userId,
                datacontenttype: "application/json",
                data: {
                    oldProgram: DbProgram.toProgram(oldProgram),
                    newProgram: DbProgram.toProgram(newProgram)
                }
            };
        });
}

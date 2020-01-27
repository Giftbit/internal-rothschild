import {LightrailEvent} from "./LightrailEvent";
import {getContactCreatedEvents, getContactDeletedEvents, getContactUpdatedEvents} from "./getContactEvents";
import {getCurrencyCreatedEvents, getCurrencyDeletedEvents, getCurrencyUpdatedEvents} from "./getCurrencyEvents";
import {getValueCreatedEvents, getValueDeletedEvents, getValueUpdatedEvents} from "./getValueEvents";
import {getTransactionCreatedEvents} from "./getTransactionEvents";
import {BinlogTransaction} from "../binlogTransaction/BinlogTransaction";
import {getProgramCreatedEvents, getProgramDeletedEvents, getProgramUpdatedEvents} from "./getProgramEvents";

const eventGetters: ((tx: BinlogTransaction) => Promise<LightrailEvent[]>)[] = [
    getContactCreatedEvents,
    getContactDeletedEvents,
    getContactUpdatedEvents,
    getCurrencyCreatedEvents,
    getCurrencyDeletedEvents,
    getCurrencyUpdatedEvents,
    getProgramCreatedEvents,
    getProgramDeletedEvents,
    getProgramUpdatedEvents,
    getTransactionCreatedEvents,
    getValueCreatedEvents,
    getValueDeletedEvents,
    getValueUpdatedEvents
];

/**
 * Get all LightrailEvents to publish from the BinlogTransaction.
 * @param tx
 */
export async function getLightrailEvents(tx: BinlogTransaction): Promise<LightrailEvent[]> {
    const events: LightrailEvent[] = [];
    for (const eventGetter of eventGetters) {
        events.splice(events.length, 0, ...await eventGetter(tx));
    }
    return events;
}

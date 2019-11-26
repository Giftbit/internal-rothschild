import {LightrailMessage} from "../LightrailMessage";
import {BinlogTransaction} from "../BinlogTransaction";
import {getContactCreatedMessages, getContactDeletedMessages, getContactUpdatedMessages} from "./getContactMessages";
import {
    getCurrencyCreatedMessages,
    getCurrencyDeletedMessages,
    getCurrencyUpdatedMessages
} from "./getCurrencyMessages";
import {getValueCreatedMessages, getValueDeletedMessages, getValueUpdatedMessages} from "./getValueMessages";
import {getTransactionCreatedMessages} from "./getTransactionMessages";

const messageGetters: ((tx: BinlogTransaction) => Promise<LightrailMessage[]>)[] = [
    getContactCreatedMessages,
    getContactDeletedMessages,
    getContactUpdatedMessages,
    getCurrencyCreatedMessages,
    getCurrencyDeletedMessages,
    getCurrencyUpdatedMessages,
    getTransactionCreatedMessages,
    getValueCreatedMessages,
    getValueDeletedMessages,
    getValueUpdatedMessages
];

export async function getLightrailMessages(tx: BinlogTransaction): Promise<LightrailMessage[]> {
    const msgs: LightrailMessage[] = [];
    for (const msgGetter of messageGetters) {
        msgs.splice(msgs.length, 0, ...await msgGetter(tx));
    }
    return msgs;
}

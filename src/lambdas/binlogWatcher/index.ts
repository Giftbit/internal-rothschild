import * as awslambda from "aws-lambda";
import * as logPrefix from "loglevel-plugin-prefix";
import {getDbCredentials} from "../../utils/dbUtils/connection";
import {BinlogStream} from "./binlogStream/BinlogStream";
import {BinlogTransaction} from "./BinlogTransaction";
import log = require("loglevel");

// Wrapping console.log instead of binding (default behaviour for loglevel)
// Otherwise all log calls are prefixed with the requestId from the first
// request the lambda received (AWS modifies log calls, loglevel binds to the
// version of console.log that exists when it is initialized).
// See https://github.com/pimterry/loglevel/blob/master/lib/loglevel.js
// tslint:disable-next-line:no-console
log.methodFactory = () => (...args) => console.log(...args);

// Prefix log messages with the level.
logPrefix.reg(log);
logPrefix.apply(log, {
    format: (level, name, timestamp) => {
        return `[${level}]`;
    },
});

log.setLevel(process.env.LOG_LEVEL as any || log.levels.INFO);

export async function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<any> {

}

export async function createMySqlEventsInstance(): Promise<BinlogStream> {
    const dbCredentials = await getDbCredentials();
    const instance = new BinlogStream({
        host: process.env["DB_ENDPOINT"],
        user: dbCredentials.username,
        password: dbCredentials.password,
        port: +process.env["DB_PORT"],
        timezone: "Z"
    }, {
        serverId: 1234,
        filename: "bin.000025",
        position: 24519,
        excludeSchema: {
            mysql: true,
        }
    });
    instance.on("transaction", (tx: BinlogTransaction) => console.log(tx));

    await instance.start();

    return instance;
}

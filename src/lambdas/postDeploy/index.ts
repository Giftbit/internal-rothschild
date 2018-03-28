import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as mysql from "promise-mysql";
import {sendCloudFormationResponse} from "../../sendCloudFormationResponse";
import {getDbCredentials} from "../../dbUtils";

/**
 * Handles a CloudFormationEvent and upgrades the database.
 */
export function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context, callback: awslambda.Callback): void {
    console.log("event", JSON.stringify(evt, null, 2));
    handlerAsync(evt, ctx)
        .then(data => {
            return sendCloudFormationResponse(evt, ctx, true, data);
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            return sendCloudFormationResponse(evt, ctx, false, null, err.message);
        })
        .then(() => {
            callback(undefined, {});
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<{}> {
    if (evt.RequestType === "Delete") {
        console.log("This action cannot be rolled back.  Calling success without doing anything.");
        return {};
    }

    const connection = await getConnection(ctx);

    await putBaseSchema(connection);

    // // This lock will only last as long as this connection does.
    // console.log("locking database");
    // await connection.query("FLUSH TABLES WITH WRITE LOCK;");
    //
    // // And this is where we look at the schemaChanges table, and apply needed patches in order.
    // // Patch files will go in ./schema.  They must be in a sequential order and never modified.
    // // How do we enforce that?
    //
    // console.log("unlocking database");
    // await connection.query("UNLOCK TABLES;");

    await connection.end();

    return {};
}

async function getConnection(ctx: awslambda.Context): Promise<mysql.Connection> {
    const credentials = await getDbCredentials();

    while (true) {
        try {
            console.log(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
            return await await mysql.createConnection({
                // multipleStatements = true removes a protection against injection attacks.
                // We're running scripts and not accepting user input here so that's ok,
                // but other clients should *not* do that.
                multipleStatements: true,
                host: process.env["DB_ENDPOINT"],
                port: +process.env["DB_PORT"],
                user: credentials.username,
                password: credentials.password,
                timezone: "Z"
            });
        } catch (err) {
            console.log("error connecting to database", err);
            if (err.code && (err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") && ctx.getRemainingTimeInMillis() > 60000) {
                console.log("retrying...");
            } else {
                throw err;
            }
        }
    }
}

async function putBaseSchema(connection: mysql.Connection, force: boolean = false): Promise<void> {
    console.log("checking for schema");
    const schemaRes = await connection.query("SELECT schema_name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?", ["rothschild"]);
    console.log("checked for schema", JSON.stringify(schemaRes));
    if (schemaRes.length > 0) {
        if (force) {
            console.log("!!! FORCING DATABASE SCHEMA FROM BASE !!!");
            console.log("dropping schema");
            const dropRes = await connection.query("DROP DATABASE rothschild;");
            console.log("dropped schema", JSON.stringify(dropRes));
        } else {
            return;
        }
    }

    const sql = require("./schema/base.sql");
    console.log("applying base schema");
    const baseSchemaRes = await connection.query(sql);
    console.log("applied base schema", JSON.stringify(baseSchemaRes));
}

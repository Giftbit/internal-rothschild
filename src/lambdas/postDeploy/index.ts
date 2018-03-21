import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as https from "https";
import * as mysql from "promise-mysql";
import * as url from "url";

/**
 * Handles a CloudFormationEvent and upgrades the database.
 */
export function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context, callback: awslambda.Callback): void {
    console.log("event", JSON.stringify(evt, null, 2));
    handlerAsync(evt, ctx)
        .then(() => {
            callback(undefined, {});
        }, err => {
            console.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<void> {
    if (evt.RequestType === "Delete") {
        console.log("This action cannot be rolled back.  Calling success without doing anything.");
        await sendResponse(evt, ctx, true, {}, "This action cannot be rolled back.");
        return;
    }

    try {
        const connection = await getConnection(ctx);

        await putBaseSchema(connection);

        // // This lock will only last as long as this connection does.
        // console.log("locking database");
        // await connection.query("FLUSH TABLES WITH WRITE LOCK;");
        //
        // console.log("unlocking database");
        // await connection.query("UNLOCK TABLES;");

        await connection.end();

        await sendResponse(evt, ctx, true, {});
    } catch (err) {
        console.error("error", err);
        await sendResponse(evt, ctx, false, {}, err.message);
        return;
    }
}

async function getConnection(ctx: awslambda.Context): Promise<mysql.Connection> {
    while (true) {
        try {
            console.log(`connecting to ${process.env["DB_ENDPOINT"]}:${process.env["DB_PORT"]}`);
            return await await mysql.createConnection({
                multipleStatements: true,   // This make
                host: process.env["DB_ENDPOINT"],
                port: +process.env["DB_PORT"],
                user: process.env["DB_USERNAME"],
                password: process.env["DB_PASSWORD"]    // TODO don't get from env var
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
    const schemaRes = await connection.query("SELECT schema_name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = 'rothschild';");
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

/**
 * PUT the result of this CloudFormation task to the web callback expecting it.
 */
async function sendResponse(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context, success: boolean, data?: {[key: string]: string}, reason?: string): Promise<void> {
    const responseBody: any = {
        StackId: evt.StackId,
        RequestId: evt.RequestId,
        LogicalResourceId: evt.LogicalResourceId,
        PhysicalResourceId: ctx.logStreamName,
        Status: success ? "SUCCESS" : "FAILED",
        Reason: reason || `See details in CloudWatch Log: ${ctx.logStreamName}`,
        Data: data
    };

    console.log(`Sending CloudFormationResponse ${JSON.stringify(responseBody, null, 2)}`);

    const responseJson = JSON.stringify(responseBody);
    const parsedUrl = url.parse(evt.ResponseURL);
    const options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseJson.length
        }
    };

    await new Promise((resolve, reject) => {
        const request = https.request(options, (response) => {
            console.log(`CloudFormationResponse response.statusCode ${response.statusCode}`);
            console.log(`CloudFormationResponse response.headers ${JSON.stringify(response.headers)}`);
            const responseBody: string[] = [];
            response.setEncoding("utf8");
            response.on("data", d => {
                responseBody.push(d as string);
            });
            response.on("end", () => {
                console.log("CloudFormationResponse response.body", responseBody);
                if (response.statusCode >= 400) {
                    reject(new Error(responseBody.join("")));
                } else {
                    resolve();
                }
            });
        });

        request.on("error", error => {
            console.log("sendResponse error", error);
            reject(error);
        });

        request.on("end", () => {
            console.log("end");
        });

        request.write(responseJson);
        request.end();
    });
}

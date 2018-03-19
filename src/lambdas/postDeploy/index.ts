import "babel-polyfill";
import * as awslambda from "aws-lambda";
import * as https from "https";
import * as mysql from "promise-mysql";
import * as url from "url";

/**
 * Handles a CloudFormationEvent and does any necessary Elasticsearch
 * configuration not available from CloudFormation (which is almost everything).
 * Currently the only action is PUTing the Card index template.
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
        sendResponse(evt, ctx, true, {}, "This action cannot be rolled back.");
        return;
    }

    try {
        await execSql("SHOW DATABASES");
        sendResponse(evt, ctx, true, {});
    } catch (err) {
        console.log("Error running post deploy", err);
        sendResponse(evt, ctx, false, {}, err.message);
    }
}

async function execSql(sql: string): Promise<void> {
    console.log("connecting to", {
        host: process.env["DB_ENDPOINT"],
        port: +process.env["DB_PORT"],
        user: process.env["DB_USERNAME"],
        password: process.env["DB_PASSWORD"]
    });

    const connection = await mysql.createConnection({
        host: process.env["DB_ENDPOINT"],
        port: +process.env["DB_PORT"],
        user: process.env["DB_USERNAME"],
        password: process.env["DB_PASSWORD"]
    });

    console.log("connected");

    const dbs = await connection.query("SHOW DATABASES");
    console.log("databases=", dbs);

    await connection.end();
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
            console.log(`response.statusCode ${response.statusCode}`);
            console.log(`response.headers ${JSON.stringify(response.headers)}`);
            const responseBody: string[] = [];
            response.setEncoding("utf8");
            response.on("data", d => {
                responseBody.push(d as string);
            });
            response.on("end", () => {
                if (response.statusCode >= 400) {
                    console.log("response error", responseBody);
                    reject(new Error(responseBody.join("")));
                } else {
                    try {
                        const responseJson = JSON.parse(responseBody.join(""));
                        resolve(responseJson);
                    } catch (e) {
                        reject(e);
                    }
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

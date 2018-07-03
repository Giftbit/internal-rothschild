import * as awslambda from "aws-lambda";
import * as https from "https";
import * as log from "loglevel";
import * as url from "url";

log.setLevel(log.levels.DEBUG);

/**
 * PUT the result of this CloudFormation task to the web callback expecting it.
 */
export async function sendCloudFormationResponse(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context, success: boolean, data?: {[key: string]: string}, reason?: string): Promise<void> {
    const responseBody: any = {
        StackId: evt.StackId,
        RequestId: evt.RequestId,
        LogicalResourceId: evt.LogicalResourceId,
        PhysicalResourceId: ctx.logStreamName,
        Status: success ? "SUCCESS" : "FAILED",
        Reason: reason || `See details in CloudWatch Log: ${ctx.logStreamName}`,
        Data: data
    };

    log.info(`sending CloudFormationResponse`);

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
            log.info(`CloudFormationResponse ack statusCode ${response.statusCode}`);
            log.info(`CloudFormationResponse ack headers ${JSON.stringify(response.headers)}`);
            const responseBody: string[] = [];
            response.setEncoding("utf8");
            response.on("data", d => {
                responseBody.push(d as string);
            });
            response.on("end", () => {
                log.info("CloudFormationResponse ack body", responseBody);
                if (response.statusCode >= 400) {
                    reject(new Error(responseBody.join("")));
                } else {
                    resolve();
                }
            });
        });

        request.on("error", error => {
            log.error("error sending CloudFormationResponse", error);
            reject(error);
        });

        request.on("end", () => {
            log.info("sent CloudFormationResponse");
        });

        request.write(responseJson);
        request.end();
    });
}

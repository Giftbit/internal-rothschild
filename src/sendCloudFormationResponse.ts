import * as awslambda from "aws-lambda";
import * as url from "url";
import * as https from "https";

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

    console.log(`Sending CloudFormationResponse`);

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

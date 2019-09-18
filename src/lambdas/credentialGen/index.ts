import * as aws from "aws-sdk";
import * as awslambda from "aws-lambda";
import {sendCloudFormationResponse} from "../../utils/sendCloudFormationResponse";
import log = require("loglevel");

// Wrapping console.log instead of binding (default behaviour for loglevel)
// Otherwise all log calls are prefixed with the requestId from the first
// request the lambda received (AWS modifies log calls, loglevel binds to the
// version of console.log that exists when it is initialized).
// See https://github.com/pimterry/loglevel/blob/master/lib/loglevel.js
// tslint:disable-next-line:no-console
log.methodFactory = () => (...args) => console.log(...args);

log.setLevel(log.levels.DEBUG);

/**
 * Handles a CloudFormationEvent and generates database credentials.
 */
export function handler(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context, callback: awslambda.Callback): void {
    log.info("event", JSON.stringify(evt, null, 2));
    handlerAsync(evt, ctx)
        .then(data => {
            return sendCloudFormationResponse(evt, ctx, true, data);
        }, err => {
            log.error(JSON.stringify(err, null, 2));
            return sendCloudFormationResponse(evt, ctx, false, null, err.message);
        })
        .then(() => {
            callback(undefined, {});
        }, err => {
            log.error(JSON.stringify(err, null, 2));
            callback(err);
        });
}

async function handlerAsync(evt: awslambda.CloudFormationCustomResourceEvent, ctx: awslambda.Context): Promise<{}> {
    if (!evt.ResourceProperties.KmsKeyId) {
        throw new Error("ResourceProperties.KmsKeyId is undefined");
    }
    if (!evt.ResourceProperties.SsmPrefix) {
        throw new Error("ResourceProperties.SsmPrefix is undefined");
    }

    const ssm = new aws.SSM({
        apiVersion: "2014-11-06",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    const passwordParameter = `${evt.ResourceProperties.SsmPrefix}-password`;

    if (evt.RequestType === "Create" || evt.RequestType === "Update") {
        log.info("setting credentials PasswordParameter=", passwordParameter, "KeyId=", evt.ResourceProperties.KmsKeyId);

        const password = generateString(36);

        await ssm.putParameter({
            Name: passwordParameter,
            Description: `Database password for ${evt.ResourceProperties.SsmPrefix}`,
            Value: password,
            Type: "SecureString",
            KeyId: evt.ResourceProperties.KmsKeyId,
            Overwrite: true,
            AllowedPattern: "^[a-zA-Z0-9]{8,41}$"
        }).promise();

        return {
            Password: password,
            PasswordParameter: passwordParameter
        };
    } else if (evt.RequestType === "Delete") {
        await ssm.deleteParameters({
            Names: [passwordParameter]
        });

        return {};
    }

    throw Error("Unknown RequestType");
}

function generateString(length: number): string {
    const legalChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let s = "";
    for (let i = 0; i < length; i++) {
        s += legalChars.charAt(Math.random() * legalChars.length);
    }
    return s;
}

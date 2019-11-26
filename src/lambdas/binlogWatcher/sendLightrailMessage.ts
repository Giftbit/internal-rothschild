import * as aws from "aws-sdk";
import {LightrailMessage} from "./LightrailMessage";
import log = require("loglevel");

const sns = new aws.SNS({
    apiVersion: "2010-03-31",
    credentials: new aws.EnvironmentCredentials("AWS"),
    region: process.env["AWS_REGION"]
});

async function sendLightrailMessage(msg: LightrailMessage): Promise<void> {
    try {
        await sns.publish({
            Message: JSON.stringify(msg.payload),
            MessageAttributes: {
                type: {
                    DataType: "String",
                    StringValue: msg.type
                },
                service: {
                    DataType: "String",
                    StringValue: msg.service
                },
                userId: msg.userId && {
                    DataType: "String",
                    StringValue: msg.userId
                },
                createdDate: {
                    DataType: "String",
                    StringValue: msg.createdDate
                }
            },
            TopicArn: process.env["STATE_CHANGE_TOPIC_ARN"]
        });
    } catch (error) {
        log.error("Error sending LightrailMessage", error);
        throw error;
    }
}

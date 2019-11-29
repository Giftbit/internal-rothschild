import * as aws from "aws-sdk";
import {EventEmitter} from "events";
import {LightrailMessage} from "./binlogWatcher/LightrailMessage";
import log = require("loglevel");

export class LightrailMessagePublisher extends EventEmitter {

    private sns = new aws.SNS({
        apiVersion: "2010-03-31",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    // TODO this is fragile, fix it
    /**
     * Backlog of messages to send to SNS after a failure.  If this is non-empty
     * the retry loop must be running.  If it's empty the retry loop must be
     * finished.  This bit of state is rather delicate.
     */
    private backlog: LightrailMessage[] = [];

    async publish(msg: LightrailMessage): Promise<void> {
        if (this.backlog.length) {
            this.backlog.push(msg);
            return;
        }

        try {
            this.publishOnce(msg);
        } catch (err) {
            log.error("Error sending LightrailMessage", err);
            this.backlog.unshift(msg);
            if (this.backlog.length === 1) {
                this.startRetryLoop();
            }
        }
    }

    async publishAll(msgs: LightrailMessage[]): Promise<void> {
        for (const msg of msgs) {
            await this.publish(msg);
        }
    }

    private async publishOnce(msg: LightrailMessage): Promise<void> {
        await this.sns.publish({
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
    }

    private async startRetryLoop(): Promise<void> {
        this.emit("failing");
        let backoff = 500;
        const maxBackoff = 15000;
        const maxJitter = 500;

        while (this.backlog.length) {
            await new Promise(resolve => setTimeout(resolve, backoff + (Math.random() * maxJitter) | 0));
            backoff = Math.min(maxBackoff, backoff *= 2);
            let err: any = null;
            while (!err) {
                try {
                    await this.publishOnce(this.backlog[0]);
                    this.backlog.shift();
                } catch (e) {
                    err = e;
                }
            }
        }
        this.emit("ok");
    }
}

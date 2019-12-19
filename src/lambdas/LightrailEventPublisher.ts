import * as aws from "aws-sdk";
import {LightrailEvent} from "./binlogWatcher/LightrailEvent";
import log = require("loglevel");

export class LightrailEventPublisher {

    private sns = new aws.SNS({
        apiVersion: "2010-03-31",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    private pendingPublishCount = 0;

    async publish(event: LightrailEvent): Promise<void> {
        this.pendingPublishCount++;
        let success = false;
        let backoff = 250;

        while (!success) {
            try {
                await this.publishOnce(event);
                success = true;
            } catch (e) {
                log.debug("Error publishing LightrailEvent", e);
                await new Promise(resolve => setTimeout(resolve, backoff + (Math.random() * 500) | 0));
                backoff = Math.min(15000, backoff * 2);
            }
        }
        this.pendingPublishCount--;
    }

    /**
     * Publish all events waiting for one to complete before publishing the next.
     * @param events
     */
    async publishAllInOrder(events: LightrailEvent[]): Promise<void> {
        for (const msg of events) {
            await this.publish(msg);
        }
    }

    /**
     * Publish all events simultaneously.
     * @param events
     */
    async publishAllAtOnce(events: LightrailEvent[]): Promise<void> {
        await Promise.all(events.map(e => this.publish(e)));
    }

    /**
     * Get the number of events that are pending completion of publish.
     * A high number here indicates problems reaching SNS.  Where possible
     * this can be used to implement back-pressure on the producer.
     */
    getPendingPublishCount(): number {
        return this.pendingPublishCount;
    }

    private async publishOnce(event: LightrailEvent): Promise<void> {
        await this.sns.publish({
            Message: JSON.stringify(event.payload),
            MessageAttributes: {
                type: {
                    DataType: "String",
                    StringValue: event.type
                },
                service: {
                    DataType: "String",
                    StringValue: event.service
                },
                userId: event.userId && {
                    DataType: "String",
                    StringValue: event.userId
                },
                createdDate: {
                    DataType: "String",
                    StringValue: event.createdDate
                }
            },
            TopicArn: process.env["STATE_CHANGE_TOPIC_ARN"]
        });
    }
}

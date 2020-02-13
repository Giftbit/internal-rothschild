import * as aws from "aws-sdk";
import {LightrailEvent} from "../lightrailEvents/LightrailEvent";
import {LightrailEventPublisher} from "./LightrailEventPublisher";
import log = require("loglevel");

export class LightrailEventSnsPublisher implements LightrailEventPublisher {

    private sns = new aws.SNS({
        apiVersion: "2010-03-31",
        credentials: new aws.EnvironmentCredentials("AWS"),
        region: process.env["AWS_REGION"]
    });

    private publishCount = 0;
    private pendingPublishCount = 0;

    async publish(event: LightrailEvent): Promise<void> {
        this.pendingPublishCount++;
        let success = false;
        let backoff = 250;

        while (!success) {
            try {
                await this.publishOnce(event);
                success = true;
                this.publishCount++;
            } catch (e) {
                log.warn("Error publishing LightrailEvent", e);
                await new Promise(resolve => setTimeout(resolve, backoff + (Math.random() * 500) | 0));
                backoff = Math.min(16000, backoff * 2);
                if (backoff === 16000) {
                    log.error("Error publishing LightrailEvent (has reached maximum backoff)", e);
                }
            }
        }
        this.pendingPublishCount--;
    }

    /**
     * Publish all events as quickly as possible.  SNS events are not guaranteed to
     * arrive in the same order anyways so this is usually the right idea.
     * @param events
     */
    async publishAllAtOnce(events: LightrailEvent[]): Promise<void> {
        // If the number of events is huge (issuance can trigger 20,000) then trying to publish
        // all events at once eats up all the resources and nothing gets sent quickly if at all.
        // Publishing in reasonably sized blocks is the fastest way to get it done.
        // This number has been tried with 10, 20 and 30 and 20 was by far quickest.
        const maxSimultaneousPublishCount = 20;

        this.pendingPublishCount += events.length;
        for (let i = 0; i < events.length; i += maxSimultaneousPublishCount) {
            const publishBlock = events.slice(i, i + maxSimultaneousPublishCount);
            this.pendingPublishCount -= publishBlock.length;
            await Promise.all(publishBlock.map(e => this.publish(e)));
        }
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
     * Get the number of events that have been published.
     */
    getPublishCount(): number {
        return this.publishCount;
    }

    /**
     * Get the number of events that are pending completion of publish.
     * A high number here indicates problems reaching SNS.  Where possible
     * this can be used to implement back-pressure on the producer.
     */
    getPendingPublishCount(): number {
        return this.pendingPublishCount;
    }

    private async publishOnce(event: LightrailEvent): Promise<aws.SNS.Types.PublishResponse> {
        const publishInput: aws.SNS.PublishInput = {
            Message: JSON.stringify(event.data),
            MessageAttributes: {
                specversion: {
                    DataType: "String",
                    StringValue: event.specversion
                },
                type: {
                    DataType: "String",
                    StringValue: event.type
                },
                source: {
                    DataType: "String",
                    StringValue: event.source
                },
                id: {
                    DataType: "String",
                    StringValue: event.id
                },
                time: {
                    DataType: "String",
                    StringValue: typeof event.time === "string" ? event.time : event.time.toISOString()
                },
                userid: event.userid && {
                    DataType: "String",
                    StringValue: event.userid
                },
                datacontenttype: {
                    DataType: "String",
                    StringValue: event.datacontenttype
                }
            },
            TopicArn: process.env["LIGHTRAIL_EVENT_TOPIC_ARN"]
        };
        log.debug("publish request", publishInput);
        const response = await this.sns.publish(publishInput).promise();
        log.debug("publish response", response);
        return response;
    }
}

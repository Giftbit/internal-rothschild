import {LightrailEventPublisher} from "./LightrailEventPublisher";
import {LightrailEvent} from "../lightrailEvents/LightrailEvent";

export class LightrailEventMockPublisher implements LightrailEventPublisher {

    events: LightrailEvent[] = [];

    getPendingPublishCount(): number {
        return 0;
    }

    getPublishCount(): number {
        return this.events.length;
    }

    async publish(event: LightrailEvent): Promise<void> {
        this.events.push(event);
    }

    async publishAllAtOnce(events: LightrailEvent[]): Promise<void> {
        this.events.push(...events);
    }

    async publishAllInOrder(events: LightrailEvent[]): Promise<void> {
        this.events.push(...events);
    }
}

import {LightrailEvent} from "../lightrailEvents/LightrailEvent";

export interface LightrailEventPublisher {

    publish(event: LightrailEvent): Promise<void>;

    publishAllAtOnce(events: LightrailEvent[]): Promise<void>;

    publishAllInOrder(events: LightrailEvent[]): Promise<void>;

    getPendingPublishCount(): number;

}

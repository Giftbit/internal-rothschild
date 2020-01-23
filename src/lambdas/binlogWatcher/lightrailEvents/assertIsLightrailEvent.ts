import {LightrailEvent} from "./LightrailEvent";
import * as chai from "chai";

export function assertIsLightrailEvent(event: LightrailEvent): void {
    chai.assert.isObject(event);
    chai.assert.equal(event.specversion, "1.0", "event.specversion");
    chai.assert.equal(event.source, "/lightrail/rothschild", "event.source");
    chai.assert.isString(event.id, "event.id");
    chai.assert.isString(event.time, "event.time");
    chai.assert.match(event.time as string, /\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)/, "event.time");
    chai.assert.equal(event.datacontenttype, "application/json", "event.datacontenttype");
    chai.assert.isObject(event.data, "event.data");
}

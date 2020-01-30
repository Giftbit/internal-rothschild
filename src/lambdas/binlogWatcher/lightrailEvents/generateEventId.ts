import * as crypto from "crypto";

/**
 * Generate a URL-safe LightrailEvent ID.  The parts that go into the event
 * ID are specific to each event type.  Good things to include: the event name,
 * the userId of the object, the id of the object, the time of the event.
 */
export function generateLightrailEventId(...parts: (string | number)[]): string {
    return crypto.createHash("sha1").update(parts.join("-")).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

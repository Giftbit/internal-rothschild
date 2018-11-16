import * as isoDuration from "iso8601-duration";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";

export const durationPatternString = isoDuration.pattern.toString();

const defaultDuration = isoDuration.parse("P1W");
const defaultMinDurationString = "P1D";
const defaultMaxDurationString = "P1M";

export interface GetPendingVoidDateOptions {
    defaultDuration?: string;
    minDuration?: string;
    maxDuration?: string;
}

export function getPendingVoidDate(req: { pending?: boolean | string | null }, now: Date, options?: GetPendingVoidDateOptions): Date | null {
    if (!req.pending) {
        return null;
    }
    if (req.pending === true) {
        const duration = (options && options.defaultDuration && isoDuration.parse(options.defaultDuration)) || defaultDuration;
        return isoDuration.end(duration, now);
    }

    const pendingVoidDate = isoDuration.end(isoDuration.parse(req.pending), now);
    const minDurationString = (options && options.minDuration) || defaultMinDurationString;
    const maxDurationString = (options && options.maxDuration) || defaultMaxDurationString;
    const minPendingVoidDate = isoDuration.end(isoDuration.parse(minDurationString), now);
    const maxPendingVoidDate = isoDuration.end(isoDuration.parse(maxDurationString), now);

    if (pendingVoidDate < minPendingVoidDate) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `The pending duration is less than the minimum duration of '${minDurationString}'.`);
    }
    if (pendingVoidDate > maxPendingVoidDate) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `The pending duration is greater than the maximum duration of '${maxDurationString}'.`);
    }
    return pendingVoidDate;
}

import * as isoDuration from "iso8601-duration";
import * as cassava from "cassava";
import * as giftbitRoutes from "giftbit-cassava-routes";

export const durationPatternString = isoDuration.pattern.toString();

const defaultDuration = isoDuration.parse("P1W");
const minDuration = isoDuration.parse("P1D");
const maxDuration = isoDuration.parse("P1M");
const maxDurationStripe = isoDuration.parse("P1W");

export interface GetPendingVoidDateOptions {
    hasStripe?: boolean;
}

export function getPendingVoidDate(req: { pending?: boolean | string | null }, now: Date, options?: GetPendingVoidDateOptions): Date | null {
    if (!req.pending) {
        return null;
    }
    if (req.pending === true) {
        return isoDuration.end(defaultDuration, now);
    }

    const pendingVoidDate = isoDuration.end(isoDuration.parse(req.pending), now);

    if (pendingVoidDate < isoDuration.end(minDuration, now)) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `The pending duration is less than the minimum duration of 1 day.`);
    }

    if (pendingVoidDate > isoDuration.end(maxDuration, now)) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `The pending duration is greater than the maximum duration of 1 month.`);
    }

    if (options && options.hasStripe && pendingVoidDate > isoDuration.end(maxDurationStripe, now)) {
        throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNPROCESSABLE_ENTITY, `The pending duration is greater than the maximum duration of 1 week (when using Stripe).`);
    }

    return pendingVoidDate;
}

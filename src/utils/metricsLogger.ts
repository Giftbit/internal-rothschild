import * as giftbitRoutes from "giftbit-cassava-routes";
import log = require("loglevel");

/**
 * Uses Cloudwatch logs to send arbitrary metrics to Datadog: see https://docs.datadoghq.com/integrations/amazon_lambda/#using-cloudwatch-logs for details
 * Log message follows format `MONITORING|<unix_epoch_timestamp_in_seconds>|<value>|<metric_type>|<metric_name>|#<tag_key>:<tag_value>`
 * The tag function_name:<name_of_the_function> is added automatically
 */

export function logMetric(value: number, metricType: string /*must be one of count, histogram, etc*/, metricName: string /*this is fragile*/, tags: {} | { [key: string]: string }, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
    let tagString: string = "";
    Object.keys(tags).forEach(key => tagString += `#${key}:${tags[key]},`); // trailing comma: these tags are inserted first below

    log.info(`MONITORING|` +
        `${Math.round(Date.now() / 1000)}|` +
        `${value}|` +
        `${metricType}|` +
        `${metricName}|` +
        `${tagString}` +
        `#userId:${auth.userId},` +
        `#teamMemberId:${auth.teamMemberId}`);
}


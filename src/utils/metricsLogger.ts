import * as giftbitRoutes from "giftbit-cassava-routes";
import log = require("loglevel");

/**
 * Uses Cloudwatch logs to send arbitrary metrics to Datadog: see https://docs.datadoghq.com/integrations/amazon_lambda/#using-cloudwatch-logs for details
 * Log message follows format `MONITORING|<unix_epoch_timestamp_in_seconds>|<value>|<metric_type>|<metric_name>|#<tag_key>:<tag_value>`
 * The tag function_name:<name_of_the_function> is added automatically
 */
export function logMetric(value: number, metricType: metricsType, metricName: string /*this is fragile*/, tags: {} | { [key: string]: string }, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
    let tagString: string = "";
    Object.keys(tags).forEach(key => tagString += `#${key}:${tags[key]},`);

    log.info(`MONITORING|` +
        `${Math.round(Date.now() / 1000)}|` +
        `${value}|` +
        `${metricType}|` +
        `${metricName}|` +
        `${tagString}` +
        `#userId:${auth.userId},` +
        `#teamMemberId:${auth.teamMemberId}`);
}

/**
 * Legal types of metrics: https://docs.datadoghq.com/integrations/amazon_lambda/#using-cloudwatch-logs
 */
export enum metricsType {
    histogram = "histogram",
    count = "count",
    gauge = "gauge",
    check = "check"
}

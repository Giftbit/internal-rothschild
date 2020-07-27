import * as giftbitRoutes from "giftbit-cassava-routes";
import {StripeTransactionPlanStep, TransactionPlan} from "../lambdas/rest/transactions/TransactionPlan";
import * as Stripe from "stripe";
import {Value} from "../model/Value";
import log = require("loglevel");

/**
 * Legal types of metrics: https://docs.datadoghq.com/integrations/amazon_lambda/#using-cloudwatch-logs
 */
enum MetricsType {
    Histogram = "histogram",
    Count = "count",
    Gauge = "gauge",
    Check = "check"
}

export enum ValueAttachmentTypes {
    OnCreate = "onCreate",
    Generic = "generic",
    GenericPerContactProps = "genericPerContactProps",
    GenericAsNew = "genericAsNew",
    Unique = "unique"
}

export namespace MetricsLogger {

    export function legacyDiscountSellerLiabilitySet(request: "valueCreate" | "valueUpdate" | "programCreate" | "programUpdate", auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, `rothschild.legacy.discountSellerLiabilitySet`, {type: request}, auth);
    }

    export function valueAttachment(attachType: ValueAttachmentTypes, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.values.attach", {type: attachType}, auth);
    }

    export function valueUpdated(valueUpdates: Partial<Value>, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.values.update", {
            active: valueUpdates.active + "",
            canceled: valueUpdates.canceled + "",
            contactId: valueUpdates.contactId ? "set" : valueUpdates.contactId + "",
            frozen: valueUpdates.frozen + ""
        }, auth);
    }

    export function transaction(plan: TransactionPlan, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.transactions", {type: plan.transactionType}, auth);
    }

    export function stripeCall(step: StripeTransactionPlanStep, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(step.amount, MetricsType.Histogram, "rothschild.transactions.stripe.calls", {type: step.type}, auth);
    }

    export function stripeError(error: Stripe.IStripeError, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.transactions.stripe.errors", {stripeErrorType: error.type}, auth);
    }

    export function stripeWebhookEvent(event: Stripe.events.IEvent & { account?: string }, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.stripeEventWebhook.event", {
            stripeEventType: event.type,
            stripeAccountId: event.account,
        }, auth);
    }

    export function stripeWebhookHandlerError(event: Stripe.events.IEvent & { account?: string }, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.stripeEventWebhook.error", {
            stripeEventType: event.type,
            stripeAccountId: event.account,
        }, auth);
    }

    export function stripeWebhookFraudEvent(event: Stripe.events.IEvent & { account?: string }, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.stripeEventWebhook.fraud", {
            stripeEventType: event.type,
            stripeAccountId: event.account
        }, auth);
    }

    export function stripeWebhookDisputeEvent(event: Stripe.events.IEvent & { account?: string }, auth: giftbitRoutes.jwtauth.AuthorizationBadge): void {
        logMetric(1, MetricsType.Histogram, "rothschild.stripeEventWebhook.dispute", {
            stripeEventType: event.type,
            stripeAccountId: event.account
        }, auth);
    }

    export function binlogWatcherLatency(latencyMillis: number): void {
        logMetric(latencyMillis, MetricsType.Gauge, "rothschild.binlogWatcher.latency");
    }

    export function binlogWatcherEvents(eventCount: number): void {
        logMetric(eventCount, MetricsType.Count, "rothschild.binlogWatcher.events");
    }
}

/**
 * Uses Cloudwatch logs to send arbitrary metrics to Datadog: see https://docs.datadoghq.com/integrations/amazon_lambda/#using-cloudwatch-logs for details
 * Log message follows format `MONITORING|<unix_epoch_timestamp_in_seconds>|<value>|<metric_type>|<metric_name>|#<tag_key>:<tag_value>`
 * The tag function_name:<name_of_the_function> is added automatically
 */
function logMetric(value: number, metricType: MetricsType, metricName: string, tags: { [key: string]: string } = {}, auth?: giftbitRoutes.jwtauth.AuthorizationBadge): void {
    let tagString = Object.keys(tags)
        .map(key => `#${key}:${tags[key]}`)
        .join(",");

    if (auth) {
        tagString += (tagString ? "," : "") +
            `#userId:${auth.userId},` +
            `#teamMemberId:${auth.teamMemberId},` +
            `#liveMode:${!auth.isTestUser()}`;
    }

    log.info(`MONITORING|` +
        `${Math.round(Date.now() / 1000)}|` +
        `${value}|` +
        `${metricType}|` +
        `${metricName}|` +
        `${tagString}`
    );
}

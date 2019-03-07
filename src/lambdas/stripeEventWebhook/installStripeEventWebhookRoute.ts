import log = require("loglevel");
import Stripe = require("stripe");
import * as stripe from "stripe";
import * as cassava from "cassava";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeModeConfig} from "../../utils/stripeUtils/StripeConfig";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../model/Transaction";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {createReverse, getTransaction} from "../rest/transactions/transactions";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {DbValue, Value} from "../../model/Value";
import * as Knex from "knex";


export function installStripeEventWebhookRoute(router: cassava.Router): void {
    // These paths are configured in our Stripe account and not publicly known
    // (not that it would do any harm as we verify signatures).
    router.route("/v2/stripeEventWebhook")
        .method("POST")
        .handler(async evt => {
            const testMode: boolean = !evt.body.livemode;
            const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(testMode);
            const stripe = new Stripe(lightrailStripeConfig.secretKey);

            let event;
            try {
                log.info("Verifying Stripe signature...");
                event = stripe.webhooks.constructEvent(evt.bodyRaw, evt.headersLowerCase["stripe-signature"], lightrailStripeConfig.connectWebhookSigningSecret);
                log.info("Stripe signature verified");
                // todo send 2xx immediately if signature verifies - otherwise it may time out, which means failure, which means the webhook could get turned off
            } catch (err) {
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNAUTHORIZED, "The Stripe signature could not be validated");
            }

            // todo track triggering eventID (& Stripe accountId?) in reversal/freezing metadata
            await handleRefundForFraud(event);

            return {
                statusCode: 204,
                body: null
            };
        });
}

async function handleRefundForFraud(event: stripe.events.IEvent & { account?: string }): Promise<void> {
    if (
        event.type !== "charge.refunded" ||
        event.data.object.object !== "charge" ||
        (event.data.object as stripe.charges.ICharge).refunds.data.length === 0 ||
        (event.data.object as stripe.charges.ICharge).refunds.data.find(refund => refund.reason === "fraudulent") === undefined
    ) {
        log.info(`This event does not describe a refund of a fraudulent charge. Event ID: ${event.id} with Stripe account ID: ${event.account}`);
        return;
    }
    if (!event.account) {
        // todo consider how we handle our own events
        throw new Error("This event did not come from a connected account: missing property 'account'.");
    }

    const stripeAccountId: string = event.account;
    const stripeCharge = <stripe.charges.ICharge>event.data.object;

    const auth: giftbitRoutes.jwtauth.AuthorizationBadge = getAuthBadgeFromStripeCharge(stripeAccountId, stripeCharge);

    if ((event.data.object as stripe.charges.ICharge).refunds.data.find(refund => refund.reason === "fraudulent")) {
        // Stripe supports partial refunds; if even one is marked with 'reason: fraudulent' we'll treat the Transaction as fraudulent

        log.info(`Stripe charge ${(event.data.object as stripe.charges.ICharge).id} has a refund with 'reason: fraudulent'. Reversing Lightrail Transaction and freezing all implicated Values.`);

        const lrTransaction: Transaction = await getLightrailTransactionFromStripeCharge(auth, stripeCharge);

        log.info(`Stripe charge ${stripeCharge.id} on Transaction ${lrTransaction.id} was refunded due to suspected fraud. Reversing Lightrail transaction...`);
        try {
            await createReverse(auth, {id: `${lrTransaction.id}-webhook-rev`}, lrTransaction.id);
            log.info(`Reversed Transaction ${lrTransaction.id}.`);
        } catch (e) {
            log.error(`Failed to reverse Transaction ${lrTransaction.id}. This could be because it has already been reversed. Will still try to freeze implicated Values.`);
            log.error(e);
        }

        // Get list of all Values used in the Transaction and all Values attached to Contacts used in the Transaction
        const lightrailSteps = <LightrailTransactionStep[]>lrTransaction.steps.filter(step => step.rail === "lightrail");
        let affectedValueIds: string[] = lightrailSteps.map(step => step.valueId);
        const affectedContactIds: string[] = lrTransaction.paymentSources.filter(src => src.rail === "lightrail" && src.contactId).map(src => (src as LightrailTransactionStep).contactId);

        const knex = await getKnexWrite();

        log.info(`Freezing implicated Values: '${JSON.stringify(affectedValueIds)}' and all Values attached to implicated Contacts: '${JSON.stringify(affectedContactIds)}'`);
        try {
            await freezeAffectedValues(auth, knex, {
                valueIds: affectedValueIds,
                contactIds: affectedContactIds
            }, lrTransaction.id);
            log.info("Implicated Values including all Values attached to implicated Contacts frozen.");
        } catch (e) {
            log.error(`Failed to freeze Values '${JSON.stringify(affectedValueIds)}' and Values attached to Contacts '${JSON.stringify(affectedContactIds)}'`);
            log.error(e);
        }
    }
}

async function getLightrailTransactionFromStripeCharge(auth: giftbitRoutes.jwtauth.AuthorizationBadge, stripeCharge: stripe.charges.ICharge): Promise<Transaction> {
    const presumedTransactionId = stripeCharge.metadata["lightrailTransactionId"];
    const lrTransaction: Transaction = await getTransaction(auth, presumedTransactionId);

    const stripeSteps = <StripeTransactionStep[]>lrTransaction.steps.filter(step => step.rail === "stripe");
    const affectedChargeStep: StripeTransactionStep = stripeSteps.find(step => step.chargeId === stripeCharge.id);

    if (!affectedChargeStep) {
        throw new Error(`ID mismatch: Stripe charge ${stripeCharge.id} lists Lightrail Transaction ID ${presumedTransactionId} in its metadata, but Transaction ${presumedTransactionId} does not have a Stripe step with ID ${stripeCharge.id}. This could indicate that the charge metadata was modified.`);
    }
    if (// Check fields that should be immutable to make sure they are the same object. Can't do a deep equality check because refund details will be different.
        affectedChargeStep.charge.amount !== stripeCharge.amount ||
        affectedChargeStep.charge.created !== stripeCharge.created
    ) {
        throw new Error(`Property mismatch: Stripe charge ${stripeCharge.id} should match the charge object on StripeTransactionStep ${affectedChargeStep.charge.id} (with parent Transaction ID ${presumedTransactionId}) except for refund details.`);
    }

    return lrTransaction;
}

async function freezeAffectedValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, knex: Knex, valueIdentifiers: { valueIds?: string[], contactIds?: string[] }, lightrailTransactionId: string): Promise<void> {
    await knex.transaction(async trx => {
        // Get the master version of the Values and lock them.
        const selectValueRes: DbValue[] = await trx("Values").select()
            .where({
                userId: auth.userId
            })
            .where((builder) => {
                builder.whereIn("id", valueIdentifiers.valueIds)
                    .orWhereIn("contactId", valueIdentifiers.contactIds);
            })
            .forUpdate();

        if (selectValueRes.length === 0) {
            throw new giftbitRoutes.GiftbitRestError(404, `Values to freeze not found for Transaction '${lightrailTransactionId}' with valueIdentifiers '${JSON.stringify(valueIdentifiers)}'.`, "ValueNotFound");
        }

        const existingValues: Value[] = await Promise.all(selectValueRes.map(async dbValue => await DbValue.toValue(dbValue)));

        const updateRes: number = await trx("Values")
            .where({
                userId: auth.userId,
            })
            .whereIn("id", existingValues.map(value => value.id))
            .update({frozen: true});
        if (updateRes === 0) {
            throw new cassava.RestError(404);
        }
        if (updateRes < selectValueRes.length) {
            throw new Error(`Illegal UPDATE query. Updated ${updateRes} Values, should have updated ${selectValueRes.length} Values.`);
        }

        return; // note we could return the updated values here
    });
}


/**
 * This is a workaround method. When we can get the Lightrail userId directly from the Stripe accountId, we won't need to pass in the charge.
 * @param stripeAccountId
 * @param stripeCharge
 */
function getAuthBadgeFromStripeCharge(stripeAccountId: string, stripeCharge: stripe.charges.ICharge): giftbitRoutes.jwtauth.AuthorizationBadge {
    const lightrailUserId = getLightrailUserIdFromStripeCharge(stripeAccountId, stripeCharge);

    return new AuthorizationBadge({
        g: {
            gui: lightrailUserId,
            tmi: lightrailUserId,
        }
    });
}

/**
 * This is a workaround method. For now, it relies on finding the Lightrail userId directly in the charge metadata.
 * This is not reliable or safe as a permanent solution; it's waiting on the new user service to provide a direct mapping
 * from Stripe accountId to Lightrail userId. When that happens, we won't need to pass the charge object in.
 * @param stripeAccountId
 * @param stripeCharge
 */
function getLightrailUserIdFromStripeCharge(stripeAccountId: string, stripeCharge: stripe.charges.ICharge): string {
    if (stripeCharge.metadata["lightrailUserId"] && stripeCharge.metadata["lightrailUserId"].length > 0) {
        return stripeCharge.metadata["lightrailUserId"];
    } else {
        throw new Error(`Could not get Lightrail userId from Stripe accountId ${stripeAccountId} and charge ${stripeCharge.id}`);
    }
}
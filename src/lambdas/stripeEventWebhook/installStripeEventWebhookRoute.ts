import log = require("loglevel");
import Stripe = require("stripe");
import * as cassava from "cassava";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeModeConfig} from "../../utils/stripeUtils/StripeConfig";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbTransaction, LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../model/Transaction";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {createReverse, createVoid, getDbTransactionChain, getTransaction} from "../rest/transactions/transactions";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {DbValue, Value} from "../../model/Value";
import {retrieveCharge} from "../../utils/stripeUtils/stripeTransactions";
import {generateCode} from "../../utils/codeGenerator";
import {MetricsLogger as metricsLogger} from "../../utils/metricsLogger";

export function installStripeEventWebhookRoute(router: cassava.Router): void {
    // These paths are configured in our Stripe account and not publicly known
    // (not that it would do any harm as we verify signatures).
    router.route("/v2/stripeEventWebhook")
        .method("POST")
        .handler(async evt => {
            const isTestMode: boolean = !evt.body.livemode;
            const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(isTestMode);
            const stripe = new Stripe(lightrailStripeConfig.secretKey);

            let event: Stripe.events.IEvent & { account?: string };
            log.info(`Verifying Stripe signature for eventId '${evt.body.id}' from account '${evt.body.account}'`);
            try {
                event = stripe.webhooks.constructEvent(evt.bodyRaw, evt.headersLowerCase["stripe-signature"], lightrailStripeConfig.connectWebhookSigningSecret);
                log.info(`Stripe signature verified. Event: ${JSON.stringify(event)}`);
            } catch (err) {
                log.info(`Event '${evt.body.id}' could not be verified.`);
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNAUTHORIZED, "The Stripe signature could not be validated");
            }

            if (event.account) {
                await handleConnectedAccountEvent((event as Stripe.events.IEvent & { account: string }));
            } else {
                log.warn(`Received event '${event.id}' that did not have property 'account'. This endpoint is not configured to handle events from the Lightrail Stripe account.`);
                return {
                    statusCode: 204,
                    body: null
                };
            }

            return {
                statusCode: 204,
                body: null
            };
        });
}

async function handleConnectedAccountEvent(event: Stripe.events.IEvent & { account: string }): Promise<void> {
    const stripeAccountId: string = event.account;
    const stripeCharge: Stripe.charges.ICharge = await getStripeChargeFromEvent(event); // todo refactor when we have mapping from Stripe accountId to Lightrail userId: won't need to get charge to get auth badge
    const auth = await getAuthBadgeFromStripeCharge(stripeAccountId, stripeCharge, event);

    logEvent(auth, event);
    if (isEventForLoggingOnly(event)) {
        return;
    } else if (isFraudActionEvent(event)) {
        await handleFraudReverseEvent(auth, event, stripeCharge);
    } else {
        log.info(`Received Connected Account event of type '${event.type}', eventId '${event.id}', accountId '${event.account}'. This event does not indicate that fraud has occurred: exiting without handling.`);
        return;
    }
}

async function handleFraudReverseEvent(auth: giftbitRoutes.jwtauth.AuthorizationBadge, event: Stripe.events.IEvent & { account: string }, stripeCharge: Stripe.charges.ICharge): Promise<void> {
    log.info(`Event ${event.id} indicates that fraud has occurred. Reversing corresponding Lightrail Transaction and freezing associated Values.`);
    metricsLogger.stripeWebhookFraudEvent(event, auth);

    let lightrailTransaction: Transaction;
    try {
        const dbTransaction = await getRootDbTransactionFromStripeCharge(stripeCharge);
        [lightrailTransaction] = await DbTransaction.toTransactions([dbTransaction], auth.userId);
    } catch (e) {
        log.error(`Failed to fetch Lightrail Transaction from Stripe charge '${stripeCharge.id}'. Exiting and returning success response to Stripe since this is likely Lightrail problem. Event=${JSON.stringify(event)}`);
        metricsLogger.stripeWebhookHandlerError(event, auth);
        giftbitRoutes.sentry.sendErrorNotification(e);
        return; // send success response to Stripe since this is likely a Lightrail issue
    }

    let handlingTransaction: Transaction;
    try {
        handlingTransaction = await reverseOrVoidFraudulentTransaction(auth, (event as Stripe.events.IEvent & { account: string }), stripeCharge, lightrailTransaction);
    } catch (e) {
        metricsLogger.stripeWebhookHandlerError(event, auth);
        giftbitRoutes.sentry.sendErrorNotification(e);
        // Don't exit or throw a real error here since we still want to try to freeze the Values
    }

    try {
        await freezeLightrailSources(auth, event, stripeCharge, lightrailTransaction, handlingTransaction);
    } catch (e) {
        metricsLogger.stripeWebhookHandlerError(event, auth);
        giftbitRoutes.sentry.sendErrorNotification(e);
    }
}

function isEventForLoggingOnly(event: Stripe.events.IEvent & { account: string }) {
    return event.type === "charge.dispute.created" || (event.type === "charge.refund.updated" && (event.data.object as Stripe.refunds.IRefund).status === "failed");
}

function logEvent(auth: giftbitRoutes.jwtauth.AuthorizationBadge, event: Stripe.events.IEvent & { account: string }) {
    metricsLogger.stripeWebhookEvent(event, auth);

    if (event.type === "charge.dispute.created") {
        log.info(`Event ${event.id} indicates a charge dispute which usually means fraud. Sending metrics data but taking no further action until fraud action confirmed.`);
        metricsLogger.stripeWebhookDisputeEvent(event, auth);
        return;
    } else if ((event.type === "charge.refund.updated" && (event.data.object as Stripe.refunds.IRefund).status === "failed")) {
        log.info(`Event ${event.id} indicates a refund failure with failure reason '${(event.data.object as Stripe.refunds.IRefund).failure_reason}'. Sending error notification and taking no further action. State of Stripe and Lightrail may be inconsistent.`);
        giftbitRoutes.sentry.sendErrorNotification(new Error(`Event of type '${event.type}', eventId '${event.id}', accountId '${event.account}' indicates a refund failure with failure reason '${(event.data.object as Stripe.refunds.IRefund).failure_reason}'. State of Stripe and Lightrail may be inconsistent.`));
        return;
    }
}

async function getRootDbTransactionFromStripeCharge(stripeCharge: Stripe.charges.ICharge): Promise<DbTransaction> {
    try {
        const knex = await getKnexRead();
        const res: DbTransaction[] = await knex("Transactions")
            .join("StripeTransactionSteps", {
                "StripeTransactionSteps.userId": "Transactions.userId",
                "Transactions.id": "StripeTransactionSteps.transactionId",
            })
            .where({"StripeTransactionSteps.chargeId": stripeCharge.id}) // this can return multiple Transactions
            .select("Transactions.*");

        return res.find(tx => tx.id === tx.rootTransactionId);
    } catch (e) {
        throw new giftbitRoutes.GiftbitRestError(404, `Could not find Lightrail Transaction corresponding to Stripe Charge '${stripeCharge.id}'.`, "TransactionNotFound");
    }
}

async function reverseOrVoidFraudulentTransaction(auth: giftbitRoutes.jwtauth.AuthorizationBadge, event: Stripe.events.IEvent & { account: string }, stripeCharge: Stripe.charges.ICharge, lightrailTransaction: Transaction): Promise<Transaction> {
    if (!<StripeTransactionStep>lightrailTransaction.steps.find(step => step.rail === "stripe" && step.chargeId === stripeCharge.id)) {
        throw new Error(`Property mismatch: Stripe charge '${stripeCharge.id}' should match a charge in Lightrail Transaction '${lightrailTransaction.id}' except for refund details. Transaction='${JSON.stringify(lightrailTransaction)}'`);
    }

    const dbTransactionChain: DbTransaction[] = await getDbTransactionChain(auth, lightrailTransaction.id);
    const dbTransactionToHandle: DbTransaction = dbTransactionChain.find(txn => txn.id === lightrailTransaction.id);

    if (!dbTransactionToHandle) {
        log.error("No dbTransactionToHandle. Exiting.");
        return;
    }

    if (isReversed(dbTransactionToHandle, dbTransactionChain)) {
        log.info(`Transaction '${dbTransactionToHandle.id}' has already been reversed. Fetching existing reverse transaction...`);
        const reverseDbTransaction = dbTransactionChain.find(txn => txn.transactionType === "reverse" && txn.rootTransactionId === dbTransactionToHandle.id);
        const reverseTransaction = await getTransaction(auth, reverseDbTransaction.id);
        log.info(`Lightrail Transaction '${dbTransactionToHandle.id}' was reversed by Transaction '${reverseTransaction.id}'`);
        return reverseTransaction;

    } else if (isReversible(dbTransactionToHandle, dbTransactionChain)) {
        const reverseTransaction = await createReverse(auth, {
            id: `${dbTransactionToHandle.id}-webhook-rev`,
            metadata: {
                stripeWebhookTriggeredAction: `Transaction reversed by Lightrail because Stripe charge '${stripeCharge.id}' was refunded as fraudulent. Stripe eventId: '${event.id}', Stripe accountId: '${event.account}'`
            }
        }, dbTransactionToHandle.id);
        log.info(`Lightrail Transaction '${dbTransactionToHandle.id}' was reversed by Transaction '${reverseTransaction.id}'`);
        return reverseTransaction;

    } else if (isCaptured(dbTransactionToHandle, dbTransactionChain)) {
        log.info(`Transaction '${dbTransactionToHandle.id}' was pending and has been captured. Reversing capture transaction...`);
        let captureDbTransaction = dbTransactionChain.find(txn => txn.transactionType === "capture" && txn.rootTransactionId === dbTransactionToHandle.id);
        const reverseTransaction = await createReverse(auth, {
            id: `${captureDbTransaction.id}-webhook-rev`,
            metadata: {
                stripeWebhookTriggeredAction: `Transaction reversed by Lightrail because Stripe charge '${stripeCharge.id}' was refunded as fraudulent. Stripe eventId: '${event.id}', Stripe accountId: '${event.account}'`
            }
        }, captureDbTransaction.id);
        log.info(`Transaction '${dbTransactionToHandle.id}' was captured by transaction '${captureDbTransaction.id}' which was reversed by '${reverseTransaction.id}'`);
        return reverseTransaction;

    } else if (isVoided(dbTransactionToHandle, dbTransactionChain)) {
        log.info(`Transaction '${dbTransactionToHandle.id}' was pending and has already been voided. Fetching existing void transaction...`);
        let voidDbTransaction = dbTransactionChain.find(txn => txn.transactionType === "void" && txn.rootTransactionId === dbTransactionToHandle.id);
        const voidTransaction = await getTransaction(auth, voidDbTransaction.id);
        log.info(`Transaction '${dbTransactionToHandle.id}' was voided by transaction '${voidTransaction.id}'`);
        return voidTransaction;

    } else if (isVoidable(dbTransactionToHandle, dbTransactionChain)) {
        log.info(`Transaction '${dbTransactionToHandle.id}' was pending: voiding...`);
        const voidTransaction = await createVoid(auth, {
            id: `${dbTransactionToHandle.id}-webhook-void`,
            metadata: {
                stripeWebhookTriggeredAction: `Transaction voided by Lightrail because Stripe charge ${stripeCharge.id} was refunded as fraudulent. Stripe eventId: ${event.id}, Stripe accountId: ${event.account}`
            }
        }, dbTransactionToHandle.id);
        log.info(`Voided Transaction '${dbTransactionToHandle.id}' with void transaction '${voidTransaction.id}'`);
        return voidTransaction;

    } else {
        throw new Error(`Stripe webhook event '${event.id}' from account '${event.account}' indicated fraud. Corresponding Lightrail Transaction '${dbTransactionToHandle.id}' could not be reversed or voided and has not already been reversed or voided. Transactions in chain: ${dbTransactionChain.map(txn => txn.id)}. Will still try to freeze charged Values.`);
    }
}

function isFraudActionEvent(event: Stripe.events.IEvent & { account?: string }): boolean {
    if (event.type === "charge.refunded") {
        // Stripe supports partial refunds; if even one is marked with 'reason: fraudulent' we'll treat the Transaction as fraudulent
        return ((event.data.object as Stripe.charges.ICharge).refunds.data.find(refund => refund.reason === "fraudulent") !== undefined);
    } else if (event.type === "charge.refund.updated") {
        const refund = event.data.object as Stripe.refunds.IRefund;
        return (refund.reason === "fraudulent");
    } else if (event.type === "review.closed") {
        return ((event.data.object as Stripe.reviews.IReview).reason === "refunded_as_fraud");
    } else if (event.type === "charge.dispute.created") {
        return true;
    } else {
        log.info(`This event is not one of ['charge.refunded', 'charge.refund.updated', 'review.closed', 'charge.dispute.created']: taking no action. Event ID: '${event.id}' with Stripe connected account ID: '${event.account}'`);
        return false;
    }
}

async function getStripeChargeFromEvent(event: Stripe.events.IEvent & { account: string }): Promise<Stripe.charges.ICharge> {
    const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(!event.livemode);

    if (event.data.object.object === "charge") {
        return event.data.object as Stripe.charges.ICharge;
    } else if (event.data.object.object === "refund") {
        const refund = event.data.object as Stripe.refunds.IRefund;
        return typeof refund.charge === "string" ? await retrieveCharge(refund.charge, lightrailStripeConfig.secretKey, event.account) : refund.charge;
    } else if (event.data.object.object === "review") {
        const review = event.data.object as Stripe.reviews.IReview;
        return typeof review.charge === "string" ? await retrieveCharge(review.charge, lightrailStripeConfig.secretKey, event.account) : review.charge;
    } else if (event.data.object.object === "dispute") {
        const dispute = event.data.object as Stripe.disputes.IDispute;
        return typeof dispute.charge === "string" ? await retrieveCharge(dispute.charge, lightrailStripeConfig.secretKey, event.account) : dispute.charge;
    } else {
        throw new Error(`Could not retrieve Stripe charge from event '${event.id}'`);
    }
}

async function freezeLightrailSources(auth: giftbitRoutes.jwtauth.AuthorizationBadge, event: Stripe.events.IEvent & { account: string }, stripeCharge: Stripe.charges.ICharge, fraudulentTransaction: Transaction, reverseOrVoidTransaction?: Transaction): Promise<void> {
    // Get list of all Values used in the Transaction and all Values attached to Contacts used in the Transaction
    const lightrailSteps = <LightrailTransactionStep[]>fraudulentTransaction.steps.filter(step => step.rail === "lightrail");
    let chargedValueIds: string[] = lightrailSteps.map(step => step.valueId);
    const chargedContactIds: string[] = fraudulentTransaction.paymentSources.filter(src => src.rail === "lightrail" && src.contactId).map(src => (src as LightrailTransactionStep).contactId);

    log.info(`Freezing charged Values: '${chargedValueIds}' and all Values attached to charged Contacts: '${chargedContactIds}'`);

    try {
        await freezeValues(auth, {
            valueIds: chargedValueIds,
            contactIds: chargedContactIds
        }, fraudulentTransaction.id, buildValueFreezeMessage(fraudulentTransaction.id, reverseOrVoidTransaction.id, stripeCharge.id, event));
        log.info("charged Values including all Values attached to charged Contacts frozen.");
    } catch (e) {
        log.error(`Failed to freeze Values '${chargedValueIds}' and/or Values attached to Contacts '${chargedContactIds}'`);
        metricsLogger.stripeWebhookHandlerError(event, auth);
        giftbitRoutes.sentry.sendErrorNotification(e);
    }
}

async function freezeValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueIdentifiers: { valueIds?: string[], contactIds?: string[] }, lightrailTransactionId: string, message: string): Promise<void> {
    const knex = await getKnexWrite();
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
            .andWhereNot("isGenericCode", true)
            .forUpdate();

        if (selectValueRes.length === 0) {
            throw new giftbitRoutes.GiftbitRestError(404, `Values to freeze not found for Transaction '${lightrailTransactionId}' with valueIdentifiers '${valueIdentifiers}'.`, "ValueNotFound");
        }

        const existingValues: Value[] = await Promise.all(selectValueRes.map(async dbValue => await DbValue.toValue(dbValue)));

        let queries = [];
        for (const value of existingValues) {
            const perValueQuery = knex("Values")
                .where({
                    userId: auth.userId,
                    id: value.id
                })
                .update(Value.toDbValueUpdate(auth, {
                    frozen: true,
                    metadata: appendWebhookActionMessageToMetadata(value.metadata, message)
                }))
                .transacting(trx);
            queries.push(perValueQuery);
        }

        await Promise.all(queries)
            .then(trx.commit)
            .catch(async err => {
                await trx.rollback;
                throw new Error(`Error freezing values. err=${err}`);
            });
    });
}

/**
 * This is a workaround method until we can get the Lightrail userId directly from the Stripe accountId.
 * When that happens we'll be able to build the badge solely from the accountId and test/live flag on the event.
 */
export async function getAuthBadgeFromStripeCharge(stripeAccountId: string, stripeCharge: Stripe.charges.ICharge, event: Stripe.events.IEvent & { account: string }): Promise<giftbitRoutes.jwtauth.AuthorizationBadge> {
    let lightrailUserId = await getLightrailUserIdFromStripeCharge(stripeAccountId, stripeCharge, !event.livemode);

    return new AuthorizationBadge({
        g: {
            gui: lightrailUserId,
            tmi: lightrailUserId,
        },
        iat: Date.now(),
        jti: `webhook-badge-${generateCode({})}`,
        scopes: ["lightrailV2:transactions:list", "lightrailV2:transactions:reverse", "lightrailV2:transactions:void", "lightrailV2:values:list", "lightrailV2:values:update", "lightrailV2:contacts:list"]
    });
}

/**
 * This is a workaround method. For now, it relies on finding the Lightrail userId by looking up the root Transaction that the Stripe charge is attached to.
 * Stripe resource IDs are globally unique so this is a reasonable temporary method.
 * When the new user service exists and provides a direct mapping from Stripe accountId to Lightrail userId, we'll be able to do a direct lookup without using the Stripe charge.
 * @param stripeAccountId
 * @param stripeCharge
 * @param testMode - currently not actually required (lightrailUserId will contain "-TEST" already) but will be for non-workaround method
 */
async function getLightrailUserIdFromStripeCharge(stripeAccountId: string, stripeCharge: Stripe.charges.ICharge, testMode: boolean): Promise<string> {
    try {
        const rootTransaction: DbTransaction = await getRootDbTransactionFromStripeCharge(stripeCharge);
        return rootTransaction.createdBy;
    } catch (e) {
        throw new Error(`Could not get Lightrail userId from Stripe accountId ${stripeAccountId} and charge ${stripeCharge.id}. \nError: ${e}`);
    }
}

function buildValueFreezeMessage(lightrailTransactionId: string, lightrailReverseId: string, stripeChargeId: string, stripeEvent: Stripe.events.IEvent & { account: string }): string {
    return `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${lightrailTransactionId}' with reverse/void transaction '${lightrailReverseId}', Stripe chargeId: '${stripeChargeId}', Stripe eventId: '${stripeEvent.id}', Stripe accountId: '${stripeEvent.account}'`;
}

function isReversible(transaction: DbTransaction, transactionChain: DbTransaction[]): boolean {
    return transaction.transactionType !== "reverse" &&
        !transaction.pendingVoidDate &&
        transaction.transactionType !== "void" &&
        transaction.transactionType !== "capture" &&
        !isReversed(transaction, transactionChain);
}

function isReversed(transaction: DbTransaction, transactionChain: DbTransaction[]): boolean {
    return !!transactionChain.find(txn => txn.transactionType === "reverse" && txn.rootTransactionId === transaction.id);
}

function isVoidable(transaction: DbTransaction, transactionChain: DbTransaction[]): boolean {
    return !!transaction.pendingVoidDate &&
        !isVoided(transaction, transactionChain);
}

function isVoided(transaction: DbTransaction, transactionChain: DbTransaction[]): boolean {
    return !!transaction.pendingVoidDate &&
        !!transactionChain.find(txn => txn.transactionType === "void" && txn.rootTransactionId === transaction.id);
}

function isCaptured(transaction: DbTransaction, transactionChain: DbTransaction[]): boolean {
    return !!transactionChain.find(txn => txn.transactionType === "capture" && txn.rootTransactionId === transaction.id);
}

function appendWebhookActionMessageToMetadata(originalMetadata: object, message: string): object {
    return {
        ...originalMetadata,
        stripeWebhookTriggeredAction: message
    };
}

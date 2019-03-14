import log = require("loglevel");
import Stripe = require("stripe");
import * as cassava from "cassava";
import {getLightrailStripeModeConfig} from "../../utils/stripeUtils/stripeAccess";
import {StripeModeConfig} from "../../utils/stripeUtils/StripeConfig";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {LightrailTransactionStep, StripeTransactionStep, Transaction} from "../../model/Transaction";
import {AuthorizationBadge} from "giftbit-cassava-routes/dist/jwtauth";
import {
    createReverse,
    createVoid,
    getDbTransaction,
    getTransaction,
    getTransactions
} from "../rest/transactions/transactions";
import {getKnexWrite} from "../../utils/dbUtils/connection";
import {DbValue, Value} from "../../model/Value";
import {stripeLiveLightrailConfig, stripeLiveMerchantConfig} from "../../utils/testUtils/stripeTestUtils";
import {retrieveCharge} from "../../utils/stripeUtils/stripeTransactions";
import {generateId} from "../../utils/testUtils";


export function installStripeEventWebhookRoute(router: cassava.Router): void {
    // These paths are configured in our Stripe account and not publicly known
    // (not that it would do any harm as we verify signatures).
    router.route("/v2/stripeEventWebhook")
        .method("POST")
        .handler(async evt => {
            const testMode: boolean = !evt.body.livemode;
            const lightrailStripeConfig: StripeModeConfig = await getLightrailStripeModeConfig(testMode);
            const stripe = new Stripe(lightrailStripeConfig.secretKey);

            let event: Stripe.events.IEvent & { account?: string };
            log.info("Verifying Stripe signature...");
            try {
                event = stripe.webhooks.constructEvent(evt.bodyRaw, evt.headersLowerCase["stripe-signature"], lightrailStripeConfig.connectWebhookSigningSecret);
                log.info(`Stripe signature verified. Event: ${JSON.stringify(event)}`);
            } catch (err) {
                log.info("Event could not be verified.");
                throw new giftbitRoutes.GiftbitRestError(cassava.httpStatusCode.clientError.UNAUTHORIZED, "The Stripe signature could not be validated");
            }

            if (event.account) {
                await handleRefundForFraud((event as any), stripe); // cast to any since event.account definitely exists here
            } else {
                log.warn("Received event that did not have property 'account'. This endpoint is not configured to handle events from the Lightrail Stripe account.");
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

async function handleRefundForFraud(event: Stripe.events.IEvent & { account: string }, stripe: Stripe): Promise<void> {
    if (!checkEventForFraudAction(event)) {
        return;
    }

    const stripeAccountId: string = event.account;

    const stripeCharge: Stripe.charges.ICharge = await getStripeChargeFromEvent(event, stripe);

    const auth = getAuthBadgeFromStripeCharge(stripeAccountId, stripeCharge);

    const lrTransaction: Transaction = await getLightrailTransactionFromStripeCharge(auth, stripeCharge);

    log.info(`Stripe charge ${stripeCharge.id} on Transaction ${lrTransaction.id} was refunded due to suspected fraud. Reversing Lightrail transaction...`);
    let reverseTransaction: Transaction;
    let voidTransaction: Transaction;
    try {
        reverseTransaction = await createReverse(auth, {
            id: `${lrTransaction.id}-webhook-rev`,
            metadata: {
                stripeWebhookTriggeredAction: `Transaction reversed by Lightrail because Stripe charge ${stripeCharge.id} was refunded as fraudulent. Stripe eventId: ${event.id}, Stripe accountId: ${event.account}`
            }
        }, lrTransaction.id);
        log.info(`Reversed Transaction ${lrTransaction.id}.`);

    } catch (e) {
        // handle other semi-reversible situations
        if ((e as giftbitRoutes.GiftbitRestError).isRestError && e.additionalParams.messageCode === "TransactionReversed") {
            log.info(`Transaction '${lrTransaction.id}' has already been reversed. Fetching existing reverse transaction...`);

            const dbTransaction = await getDbTransaction(auth, lrTransaction.id);
            reverseTransaction = (await getTransactions(auth, {
                transactionType: "reverse",
                rootTransactionId: dbTransaction.rootTransactionId
            }, {
                limit: 100, after: null, before: null, last: false, maxLimit: 1000, sort: null
            })).transactions[0];
            log.info(`Transaction '${lrTransaction.id}' was reversed by transaction '${reverseTransaction.id}'`);

        } else if ((e as giftbitRoutes.GiftbitRestError).isRestError && e.additionalParams.messageCode === "TransactionPending") {
            log.info(`Transaction '${lrTransaction.id}' was pending: voiding instead...`);
            try {
                voidTransaction = await createVoid(auth, {
                    id: `${lrTransaction.id}-webhook-void`,
                    metadata: {
                        stripeWebhookTriggeredAction: `Transaction voided by Lightrail because Stripe charge ${stripeCharge.id} was refunded as fraudulent. Stripe eventId: ${event.id}, Stripe accountId: ${event.account}`
                    }
                }, lrTransaction.id);
                log.info(`Voided Transaction '${lrTransaction.id}' with void transaction '${voidTransaction.id}'`);

            } catch (e) {
                if ((e as giftbitRoutes.GiftbitRestError).isRestError && e.additionalParams.messageCode === "TransactionVoided") {
                    log.info(`Transaction '${lrTransaction.id}' was pending and has already been voided. Fetching existing void transaction...`);

                    const dbTransaction = await getDbTransaction(auth, lrTransaction.id);
                    voidTransaction = (await getTransactions(auth, {
                        transactionType: "void",
                        rootTransactionId: dbTransaction.rootTransactionId
                    }, {
                        limit: 100, after: null, before: null, last: false, maxLimit: 1000, sort: null
                    })).transactions[0];
                    log.info(`Transaction '${lrTransaction.id}' was voided by transaction '${voidTransaction.id}'`);
                }
            }
        } else {
            log.error(`Failed to reverse Transaction ${lrTransaction.id}. This could be because it has already been reversed. Will still try to freeze implicated Values.`);
            log.error(e);
            // todo soft alert on failure
        }
    }

    // Get list of all Values used in the Transaction and all Values attached to Contacts used in the Transaction
    const lightrailSteps = <LightrailTransactionStep[]>lrTransaction.steps.filter(step => step.rail === "lightrail");
    let affectedValueIds: string[] = lightrailSteps.map(step => step.valueId);
    const affectedContactIds: string[] = lrTransaction.paymentSources.filter(src => src.rail === "lightrail" && src.contactId).map(src => (src as LightrailTransactionStep).contactId);

    const reverseOrVoidId = reverseTransaction && reverseTransaction.id || voidTransaction && voidTransaction.id || "";

    log.info(`Freezing implicated Values: '${affectedValueIds}' and all Values attached to implicated Contacts: '${affectedContactIds}'`);

    try {
        await freezeAffectedValues(auth, {
            valueIds: affectedValueIds,
            contactIds: affectedContactIds
        }, lrTransaction.id, constructValueFreezeMessage(lrTransaction.id, reverseOrVoidId, stripeCharge.id, event));
        log.info("Implicated Values including all Values attached to implicated Contacts frozen.");
    } catch (e) {
        log.error(`Failed to freeze Values '${affectedValueIds}' and/or Values attached to Contacts '${affectedContactIds}'`);
        log.error(e);
        // todo soft alert on failure
    }
}

function checkEventForFraudAction(event: Stripe.events.IEvent & { account?: string }): boolean {
    if (event.type === "charge.refunded") {
        // Stripe supports partial refunds; if even one is marked with 'reason: fraudulent' we'll treat the Transaction as fraudulent
        return ((event.data.object as Stripe.charges.ICharge).refunds.data.find(refund => refund.reason === "fraudulent") !== undefined);
    } else if (event.type === "charge.refund.updated") {
        return ((event.data.object as Stripe.refunds.IRefund).reason === "fraudulent");
    } else if (event.type === "review.closed") {
        return ((event.data.object as Stripe.reviews.IReview).reason === "refunded_as_fraud");
    } else {
        log.info(`This event is not one of ['charge.refunded', 'charge.refund.updated', 'review.closed']: taking no action. Event ID: '${event.id}' with Stripe connected account ID: '${event.account}'`);
        return false;
    }
}

async function getStripeChargeFromEvent(event: Stripe.events.IEvent, stripe: Stripe): Promise<Stripe.charges.ICharge> {
    if (event.data.object.object === "charge") {
        return event.data.object as Stripe.charges.ICharge;
    } else if (event.data.object.object === "refund") {
        const refund = event.data.object as Stripe.refunds.IRefund;
        return typeof refund.charge === "string" ? await retrieveCharge(refund.charge, stripeLiveLightrailConfig.secretKey, stripeLiveMerchantConfig.stripeUserId) : refund.charge;
    } else if (event.data.object.object === "review") {
        const review = event.data.object as Stripe.reviews.IReview;
        return typeof review.charge === "string" ? await retrieveCharge(review.charge, stripeLiveLightrailConfig.secretKey, stripeLiveMerchantConfig.stripeUserId) : review.charge;
    } else {
        throw new Error(`Could not retrieve Stripe charge from event '${event.id}'`);
    }
}

async function getLightrailTransactionFromStripeCharge(auth: giftbitRoutes.jwtauth.AuthorizationBadge, stripeCharge: Stripe.charges.ICharge): Promise<Transaction> {
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

async function freezeAffectedValues(auth: giftbitRoutes.jwtauth.AuthorizationBadge, valueIdentifiers: { valueIds?: string[], contactIds?: string[] }, lightrailTransactionId: string, message: string): Promise<void> {
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

        const updateRes: number = await trx("Values")
            .where({
                userId: auth.userId,
            })
            .whereIn("id", existingValues.map(value => value.id))
            .update(Value.toDbValueUpdate(auth, {
                frozen: true,
                metadata: {
                    stripeWebhookTriggeredAction: message
                }
            }));
        if (updateRes === 0) {
            throw new cassava.RestError(404);
        }
        if (updateRes < selectValueRes.length) {
            throw new Error(`Illegal UPDATE query. Updated ${updateRes} Values, should have updated ${selectValueRes.length} Values.`);
        }
    });
}

/**
 * This is a workaround method. When we can get the Lightrail userId directly from the Stripe accountId, we won't need to pass in the charge.
 * @param stripeAccountId
 * @param stripeCharge
 */
export function getAuthBadgeFromStripeCharge(stripeAccountId: string, stripeCharge: Stripe.charges.ICharge): giftbitRoutes.jwtauth.AuthorizationBadge {
    const lightrailUserId = getLightrailUserIdFromStripeCharge(stripeAccountId, stripeCharge);

    return new AuthorizationBadge({
        g: {
            gui: lightrailUserId,
            tmi: lightrailUserId,
        },
        iat: Date.now(),
        jti: `webhook-badge-${generateId()}`,
        scopes: ["lightrailV2:transactions", "lightrailV2:values:list", "lightrailV2:values:update", "lightrailV2:contacts:list"] // transactions:reverse, transactions:void
    });
}

/**
 * This is a workaround method. For now, it relies on finding the Lightrail userId directly in the charge metadata.
 * This is not reliable or safe as a permanent solution; it's waiting on the new user service to provide a direct mapping
 * from Stripe accountId to Lightrail userId. When that happens, we won't need to pass the charge object in.
 * @param stripeAccountId
 * @param stripeCharge
 */
function getLightrailUserIdFromStripeCharge(stripeAccountId: string, stripeCharge: Stripe.charges.ICharge): string {
    if (stripeCharge.metadata["lightrailUserId"] && stripeCharge.metadata["lightrailUserId"].length > 0) {
        return stripeCharge.metadata["lightrailUserId"];
    } else {
        throw new Error(`Could not get Lightrail userId from Stripe accountId ${stripeAccountId} and charge ${stripeCharge.id}`);
    }
}

function constructValueFreezeMessage(lightrailTransactionId: string, lightrailReverseId: string, stripeChargeId: string, stripeEvent: Stripe.events.IEvent & { account: string }): string {
    return `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${lightrailTransactionId}' with reverse transaction '${lightrailReverseId}', Stripe chargeId: '${stripeChargeId}', Stripe eventId: '${stripeEvent.id}', Stripe accountId: '${stripeEvent.account}'`;
}

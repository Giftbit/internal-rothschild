import * as giftbitRoutes from "giftbit-cassava-routes";
import {getKnexWrite} from "./dbUtils/connection";
import {DbValue, Value} from "../model/Value";
import {LightrailTransactionStep, Transaction} from "../model/Transaction";
import log = require("loglevel");
import Stripe = require("stripe");

export async function freezeLightrailSources(auth: giftbitRoutes.jwtauth.AuthorizationBadge, event: Stripe.events.IEvent & { account: string }, stripeCharge: Stripe.charges.ICharge, fraudulentTransaction: Transaction, reverseOrVoidTransaction?: Transaction): Promise<void> {
    // Get list of all Values used in the Transaction and all Values attached to Contacts used in the Transaction
    const lightrailSteps = <LightrailTransactionStep[]>fraudulentTransaction.steps.filter(step => step.rail === "lightrail");
    let chargedValueIds: string[] = lightrailSteps.map(step => step.valueId);
    const chargedContactIds: string[] = fraudulentTransaction.paymentSources.filter(src => src.rail === "lightrail" && src.contactId).map(src => (src as LightrailTransactionStep).contactId);

    log.info(`Freezing charged Values: '${chargedValueIds}' and all Values attached to charged Contacts: '${chargedContactIds}'`);

    try {
        await freezeValues(auth, {
            valueIds: chargedValueIds,
            contactIds: chargedContactIds
        }, fraudulentTransaction.id, buildValueFreezeMessage(fraudulentTransaction.id, (reverseOrVoidTransaction && reverseOrVoidTransaction.id), stripeCharge.id, event));
        log.info("charged Values including all Values attached to charged Contacts frozen.");
    } catch (e) {
        log.error(`Failed to freeze Values '${chargedValueIds}' and/or Values attached to Contacts '${chargedContactIds}'`);
        throw e;
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

function appendWebhookActionMessageToMetadata(originalMetadata: object, message: string): object {
    return {
        ...originalMetadata,
        stripeWebhookTriggeredAction: message
    };
}

function buildValueFreezeMessage(lightrailTransactionId: string, lightrailReverseId: string, stripeChargeId: string, stripeEvent: Stripe.events.IEvent & { account: string }): string {
    return `Value frozen by Lightrail because it or an attached Contact was associated with a Stripe charge that was refunded as fraudulent. Lightrail transactionId '${lightrailTransactionId}' with reverse/void transaction '${lightrailReverseId}', Stripe chargeId: '${stripeChargeId}', Stripe eventId: '${stripeEvent.id}', Stripe accountId: '${stripeEvent.account}'`;
}

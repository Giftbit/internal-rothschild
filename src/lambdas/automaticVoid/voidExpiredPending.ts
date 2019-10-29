import * as awslambda from "aws-lambda";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbTransaction} from "../../model/Transaction";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {nowInDbPrecision} from "../../utils/dbUtils";
import {executeTransactionPlanner} from "../rest/transactions/executeTransactionPlans";
import {createVoidTransactionPlanForDbTransaction} from "../rest/transactions/transactions.void";
import {StripeRestError} from "../../utils/stripeUtils/StripeRestError";
import {TransactionChainBlocker} from "../../model/TransactionChainBlocker";
import log = require("loglevel");
import uuid = require("uuid");

export async function voidExpiredPending(ctx: awslambda.Context): Promise<void> {
    const limit = 500;
    const transactions = await getExpiredPendingTransactions(limit);
    log.info(`Received ${transactions.length} pending transactions to void (max ${limit}).`);   // FUTURE metrics

    for (let txIx = 0; txIx < transactions.length; txIx++) {
        if (ctx.getRemainingTimeInMillis() < 15 * 1000) {
            // FUTURE metrics
            log.warn(`Bailing on voiding transactions with ${transactions.length} of ${transactions.length} left to void and ${ctx.getRemainingTimeInMillis()}ms remaining.  We might be falling behind!`);
            break;
        }

        try {
            await voidPendingTransaction(transactions[txIx]);
        } catch (err) {
            await handleVoidPendingError(transactions[txIx], err);
        }
    }

    if (transactions.length === limit && ctx.getRemainingTimeInMillis() > 30 * 1000) {
        log.info(`Voided max (${transactions.length}) transactions at once with time remaining.  Fetching more.`);
        return voidExpiredPending(ctx);
    }

    log.info(`Voided ${transactions.length} transactions.`);
    return;
}

export async function getExpiredPendingTransactions(limit: number): Promise<DbTransaction[]> {
    if (limit <= 0) {
        throw new Error("limit must be > 0");
    }

    const now = nowInDbPrecision();

    const knex = await getKnexRead();
    return await knex("Transactions")
        .leftOuterJoin("TransactionChainBlockers", {
            "Transactions.userId": "TransactionChainBlockers.userId",
            "Transactions.id": "TransactionChainBlockers.transactionId"
        })
        .whereNull("TransactionChainBlockers.transactionId")    // Exclusive left outer join (fancy!)
        .whereNull("Transactions.nextTransactionId")
        .where("Transactions.pendingVoidDate", "<", now)
        .limit(limit)
        .orderBy("pendingVoidDate")    // Void in the order they expired.
        .select("Transactions.*");
}

async function voidPendingTransaction(dbTransaction: DbTransaction): Promise<void> {
    // Create credentials for who we're expiring as.  Give this badge as little power as possible.
    const auth = new giftbitRoutes.jwtauth.AuthorizationBadge();
    auth.userId = dbTransaction.userId;
    auth.teamMemberId = "automatic-void";
    auth.scopes = auth.effectiveScopes = [
        "lightrailV2:transactions:void"
    ];

    await executeTransactionPlanner(
        auth,
        {
            simulate: false,
            allowRemainder: false
        },
        () => createVoidTransactionPlanForDbTransaction(
            auth,
            {
                // This operation is naturally idempotent because of the transaction chain; so this ID doesn't matter much.
                id: "automatic-void-" + uuid.v4()
            },
            dbTransaction
        )
    );
}

async function handleVoidPendingError(dbTransaction: DbTransaction, error: any): Promise<void> {
    if (StripeRestError.isStripeRestError(error)) {
        if (error.messageCode === "StripePermissionError") {
            log.warn(`StripePermissionError voiding Transaction '${dbTransaction.id}', marking as blocked`);
            return await markTransactionChainAsBlocked(dbTransaction, error.messageCode, {stripeError: error.stripeError});
        }
        if (dbTransaction.userId.endsWith("-TEST") && error.messageCode === "StripeChargeNotFound") {
            // Stripe test data can be deleted so this isn't reason to freak out.
            log.warn(`StripeChargeNotFound in test mode voiding Transaction '${dbTransaction.id}', marking as blocked`);
            return await markTransactionChainAsBlocked(dbTransaction, error.messageCode, {stripeError: error.stripeError});
        }
    }
    log.error("Unhandled Transaction void error", error);
    giftbitRoutes.sentry.sendErrorNotification(error);
}

async function markTransactionChainAsBlocked(dbTransaction: DbTransaction, blockerType: string, metadata: object): Promise<void> {
    try {
        const now = nowInDbPrecision();
        const blocker: TransactionChainBlocker = {
            userId: dbTransaction.userId,
            transactionId: dbTransaction.id,
            type: blockerType,
            metadata: metadata,
            createdDate: now,
            updatedDate: now
        };

        const knex = await getKnexWrite();
        return await knex("TransactionChainBlockers")
            .insert(TransactionChainBlocker.toDbTransactionChainBlocker(blocker));
    } catch (error) {
        log.error("Error inserting TransactionChainBlocker", error);
        giftbitRoutes.sentry.sendErrorNotification(error);
    }
}

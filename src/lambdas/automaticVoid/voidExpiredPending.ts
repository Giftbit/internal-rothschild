import * as awslambda from "aws-lambda";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbTransaction} from "../../model/Transaction";
import {getKnexRead, getKnexWrite} from "../../utils/dbUtils/connection";
import {nowInDbPrecision} from "../../utils/dbUtils";
import {executeTransactionPlan} from "../rest/transactions/executeTransactionPlan";
import {createVoidTransactionPlanForDbTransaction} from "../rest/transactions/transactions.void";
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
            log.error(`Unable to void Transaction '${transactions[txIx].id}':`, err);
            giftbitRoutes.sentry.sendErrorNotification(err);
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
        .whereNull("nextTransactionId")
        .where("pendingVoidDate", "<", now)
        .limit(limit)
        .orderBy("pendingVoidDate");    // Void in the order they expired.
}

async function voidPendingTransaction(dbTransaction: DbTransaction): Promise<void> {
    // Create credentials for who we're expiring as.  Give this badge as little power as possible.
    const auth = new giftbitRoutes.jwtauth.AuthorizationBadge();
    auth.userId = dbTransaction.userId;
    auth.teamMemberId = "automatic-void";
    auth.scopes = auth.effectiveScopes = [
        "lightrailV2:transactions:void"
    ];

    const knex = await getKnexWrite();
    await knex.transaction(async trx => {
        await executeTransactionPlan(
            auth,
            await createVoidTransactionPlanForDbTransaction(
                auth,
                {
                    // This operation is naturally idempotent because of the transaction chain; so this ID doesn't matter much.
                    id: "automatic-void-" + uuid.v4()
                },
                dbTransaction
            ),
            trx
        );
    });

}

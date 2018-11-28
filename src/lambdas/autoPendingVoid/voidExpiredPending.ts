import * as awslambda from "aws-lambda";
import * as giftbitRoutes from "giftbit-cassava-routes";
import {DbTransaction} from "../../model/Transaction";
import {getKnexRead} from "../../utils/dbUtils/connection";
import {nowInDbPrecision} from "../../utils/dbUtils";
import {executeTransactionPlanner} from "../rest/transactions/executeTransactionPlan";
import {
    createVoidTransactionPlanForDbTransaction
} from "../rest/transactions/transactions.void";
import log = require("loglevel");
import uuid = require("uuid");

export async function voidExpiredPending(ctx: awslambda.Context): Promise<void> {
    const limit = 500;
    const transactions = await getExpiredPendingTransactions(limit);
    log.info(`Received ${transactions.length} pending transactions to void (max ${limit}).`);   // FUTURE metrics

    for (let txIx = 0; txIx < transactions.length; txIx++) {
        if (ctx.getRemainingTimeInMillis() < 15000) {
            // FUTURE metrics
            log.warn(`Bailing on voiding transactions with ${transactions.length} left to void and ${ctx.getRemainingTimeInMillis()}ms remaining.  We might be falling behind!`);
            break;
        }

        await voidPendingTransaction(transactions[txIx]);
    }

    if (transactions.length === limit) {
        log.info("Received max transactions to void with time remaining, fetching more.");
        return voidExpiredPending(ctx);
    }
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

    await executeTransactionPlanner(
        auth,
        {
            simulate: false,
            allowRemainder: false
        },
        async () => {
            return await createVoidTransactionPlanForDbTransaction(
                auth,
                {
                    id: "automatic-void-" + uuid.v4()   // This operation is naturally idempotent so this ID doesn't matter much.
                },
                dbTransaction
            );
        }
    );
}

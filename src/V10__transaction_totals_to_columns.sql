SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.Transactions
  ADD COLUMN totals_subtotal INT,
  ADD COLUMN totals_tax INT,
  ADD COLUMN totals_discountLightrail INT,
  ADD COLUMN totals_paidLightrail INT,
  ADD COLUMN totals_paidStripe INT,
  ADD COLUMN totals_paidInternal INT,
  ADD COLUMN totals_remainder INT,
  ADD COLUMN totals_marketplace_sellerGross INT,
  ADD COLUMN totals_marketplace_sellerDiscount INT,
  ADD COLUMN totals_marketplace_sellerNet INT;

UPDATE rothschild.`Transactions` T
  JOIN (
         SELECT
           T.id,
           T.totals,
           IFNULL(DiscountLightrail.discountLightrail, 0)                                           discountLightrail,
           IFNULL(PaidLightrail.paidLightrail, 0)                                                   paidLightrail,
           IFNULL(PaidStripe.paidStripe, 0)                                                         paidStripe,
           IFNULL(PaidInternal.paidInternal, 0)                                                     paidInternal,

           SUBSTR(T.totals,
                  LOCATE('"subtotal":', T.totals) + 11,
                  LOCATE(',',
                         T.totals,
                         LOCATE('"subtotal":', T.totals)) - (LOCATE('"subtotal":', T.totals) + 11)) subtotal,

           SUBSTR(T.totals,
                  LOCATE('"tax":', T.totals) + 6,
                  LOCATE(',',
                         T.totals,
                         LOCATE('"tax":', T.totals)) - (LOCATE('"tax":', T.totals) + 6))            tax,

           SUBSTR(T.totals,
                  LOCATE('"remainder":', T.totals) + 12,
                  LEAST(LOCATE('}',
                               T.totals,
                               LOCATE('"remainder":', T.totals)) - (LOCATE('"remainder":', T.totals) + 12),
                        ABS(
                            LOCATE(',',
                                   T.totals,
                                   LOCATE('"remainder":', T.totals)) -
                            (LOCATE('"remainder":', T.totals) + 12))))                              remainder,

           IF(
               SUBSTR(T.totals,
                      LOCATE('"sellerGross":', T.totals) + 14,
                      LOCATE(',',
                             T.totals,
                             LOCATE('"sellerGross":', T.totals)) - (LOCATE('"sellerGross":', T.totals) + 14)) = "",
               NULL,
               SUBSTR(T.totals,
                      LOCATE('"sellerGross":', T.totals) + 14,
                      LOCATE(',',
                             T.totals,
                             LOCATE('"sellerGross":', T.totals)) - (LOCATE('"sellerGross":', T.totals) + 14))
           )                                                                                        sellerGross,

           IF(
               SUBSTR(T.totals,
                      LOCATE('"sellerDiscount":', T.totals) + 17,
                      LOCATE(',',
                             T.totals,
                             LOCATE('"sellerDiscount":', T.totals)) - (LOCATE('"sellerDiscount":', T.totals) + 17)) =
               "",
               NULL,
               SUBSTR(T.totals,
                      LOCATE('"sellerDiscount":', T.totals) + 17,
                      LOCATE(',',
                             T.totals,
                             LOCATE('"sellerDiscount":', T.totals)) - (LOCATE('"sellerDiscount":', T.totals) + 17))
           )                                                                                        sellerDiscount,

           IF(
               SUBSTR(T.totals,
                      LOCATE('"sellerNet":', T.totals) + 12,
                      LOCATE('}',
                             T.totals,
                             LOCATE('"sellerNet":', T.totals)) - (LOCATE('"sellerNet":', T.totals) + 12)) = "",
               NULL,
               SUBSTR(T.totals,
                      LOCATE('"sellerNet":', T.totals) + 12,
                      LOCATE('}',
                             T.totals,
                             LOCATE('"sellerNet":', T.totals)) - (LOCATE('"sellerNet":', T.totals) + 12))
           )                                                                                        sellerNet

         FROM rothschild.`Transactions` T

           LEFT JOIN (
                       SELECT
                         LTS.transactionId,
                         SUM(LTS.balanceChange) * -1 AS 'discountLightrail'
                       FROM rothschild.`LightrailTransactionSteps` LTS
                         JOIN rothschild.`Values` V ON LTS.valueId = V.id
                       WHERE transactionId IN (SELECT T.id
                                               FROM rothschild.`Transactions` T
                                               WHERE transactionType = 'checkout')
                             AND discount IS TRUE
                       GROUP BY LTS.transactionId
                     ) DiscountLightrail ON T.id = DiscountLightrail.transactionId

           LEFT JOIN (
                       SELECT
                         LTS.transactionId,
                         SUM(LTS.balanceChange) * -1 AS 'paidLightrail'
                       FROM rothschild.`LightrailTransactionSteps` LTS
                         JOIN rothschild.`Values` V ON LTS.valueId = V.id
                       WHERE transactionId IN (SELECT T.id
                                               FROM rothschild.`Transactions` T
                                               WHERE transactionType = 'checkout')
                             AND discount IS FALSE
                       GROUP BY LTS.transactionId
                     ) PaidLightrail ON T.id = PaidLightrail.transactionId

           LEFT JOIN (
                       SELECT
                         STS.transactionId,
                         SUM(amount) * -1 AS 'paidStripe'
                       FROM rothschild.`StripeTransactionSteps` STS
                       WHERE transactionId IN (SELECT T.id
                                               FROM rothschild.`Transactions` T
                                               WHERE transactionType = 'checkout')
                       GROUP BY STS.transactionId
                     ) PaidStripe ON T.id = PaidStripe.transactionId

           LEFT JOIN (
                       SELECT
                         ITS.transactionId,
                         SUM(balanceChange) * -1 AS 'paidInternal'
                       FROM rothschild.`InternalTransactionSteps` ITS
                       WHERE transactionId IN (SELECT T.id
                                               FROM rothschild.`Transactions` T
                                               WHERE transactionType = 'checkout')
                       GROUP BY ITS.transactionId
                     ) PaidInternal ON T.id = PaidInternal.transactionId

         WHERE T.transactionType = 'checkout'
       ) TT ON T.id = TT.id
SET
  T.totals_subtotal                   = TT.subtotal,
  T.totals_tax                        = TT.tax,
  T.totals_discountLightrail          = TT.discountLightrail,
  T.totals_paidLightrail              = TT.paidLightrail,
  T.totals_paidStripe                 = TT.paidStripe,
  T.totals_paidInternal               = TT.paidInternal,
  T.totals_remainder                  = TT.remainder,
  T.totals_marketplace_sellerGross    = TT.sellerGross,
  T.totals_marketplace_sellerDiscount = TT.sellerDiscount,
  T.totals_marketplace_sellerNet      = TT.sellerNet;

UPDATE rothschild.`Transactions` T
  JOIN (
         SELECT
           T.id,
           SUBSTR(T.totals, 14, LOCATE("}", T.totals) - 14) remainder
         FROM rothschild.`Transactions` T
         WHERE T.transactionType IN ('credit', 'debit', 'transfer') AND T.totals IS NOT NULL
       ) TT ON T.id = TT.id
SET T.totals_remainder = TT.remainder;

SET SQL_SAFE_UPDATES = 1;

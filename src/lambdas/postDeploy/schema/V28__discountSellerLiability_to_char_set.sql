SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.`Values`
  ADD COLUMN discountSellerLiabilityRule TEXT CHARACTER SET utf8mb4;

UPDATE rothschild.`Values` V
SET V.discountSellerLiabilityRule = CONCAT('{"rule":" "', CAST(V.discountSellerLiability as CHAR),
                                           '", "explanation":"Legacy discountSellerLiability migration."}')
WHERE V.discountSellerLiability IS NOT NULL;

ALTER TABLE rothschild.`Programs`
  ADD COLUMN discountSellerLiabilityRule TEXT CHARACTER SET utf8mb4;

UPDATE rothschild.`Programs` P
SET P.discountSellerLiabilityRule = CONCAT('{"rule":" "', CAST(P.discountSellerLiability as CHAR),
                                           '", "explanation":"Legacy discountSellerLiability migration."}')
WHERE P.discountSellerLiability IS NOT NULL;

SET SQL_SAFE_UPDATES = 1;
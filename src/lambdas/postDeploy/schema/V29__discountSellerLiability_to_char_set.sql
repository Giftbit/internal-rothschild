SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.`Values`
  ADD COLUMN discountSellerLiabilityRule TEXT CHARACTER SET utf8mb4;

UPDATE rothschild.`Values` V
SET V.discountSellerLiabilityRule = CONCAT('{"rule":"', CAST(V.discountSellerLiability as CHAR),
                                           '", "explanation":"Populated from deprecated property discountSellerLiability."}')
WHERE V.discountSellerLiability IS NOT NULL;

ALTER TABLE rothschild.`Values`
  DROP COLUMN discountSellerLiability;

ALTER TABLE rothschild.`Programs`
  ADD COLUMN discountSellerLiabilityRule TEXT CHARACTER SET utf8mb4;

UPDATE rothschild.`Programs` P
SET P.discountSellerLiabilityRule = CONCAT('{"rule":"', CAST(P.discountSellerLiability as CHAR),
                                           '", "explanation":"Populated from deprecated property discountSellerLiability."}')
WHERE P.discountSellerLiability IS NOT NULL;

ALTER TABLE rothschild.`Programs`
  DROP COLUMN discountSellerLiability;

SET SQL_SAFE_UPDATES = 1;
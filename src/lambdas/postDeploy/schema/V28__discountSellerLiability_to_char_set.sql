SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.`Values`
  ADD COLUMN discountSellerLiabilityRule TEXT CHARACTER SET utf8mb4;

UPDATE rothschild.`Values` V
SET V.discountSellerLiabilityRule = CAST(V.discountSellerLiability as CHAR)
WHERE V.discountSellerLiability IS NOT NULL;

ALTER TABLE rothschild.`Values`
  DROP COLUMN discountSellerLiability;

ALTER TABLE rothschild.`Programs`
  ADD COLUMN discountSellerLiabilityRule TEXT CHARACTER SET utf8mb4;

UPDATE rothschild.`Programs` P
SET P.discountSellerLiabilityRule = CAST(P.discountSellerLiability as CHAR)
WHERE P.discountSellerLiability IS NOT NULL;

ALTER TABLE rothschild.`Programs`
  DROP COLUMN discountSellerLiability;

SET SQL_SAFE_UPDATES = 1;
SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values`
SET code = SUBSTR(code, 2)
WHERE code IS NOT NULL;

SET SQL_SAFE_UPDATES = 1;

ALTER TABLE rothschild.Transactions
  ADD INDEX ix_Transactions_currency (currency);

ALTER TABLE rothschild.Issuances
  ADD COLUMN name TEXT;

SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.Issuances
SET
  name = CONCAT('issuance: ', id)
WHERE NAME IS NULL;

SET SQL_SAFE_UPDATES = 1;

ALTER TABLE rothschild.Issuances
  MODIFY COLUMN name TEXT NOT NULL;
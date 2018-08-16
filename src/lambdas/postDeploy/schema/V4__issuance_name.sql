ALTER TABLE rothschild.Issuances
  ADD COLUMN name TEXT;

SET SQL_SAFE_UPDATES = 0; # allow update to not require a primary key in where clause

UPDATE rothschild.Issuances
SET
  name = CONCAT('issuance: ', id)
WHERE NAME IS NULL;

SET SQL_SAFE_UPDATES = 1; # turn on safe updates again

ALTER TABLE rothschild.Issuances
  MODIFY COLUMN name TEXT NOT NULL;
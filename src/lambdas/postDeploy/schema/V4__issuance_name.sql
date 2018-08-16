ALTER TABLE rothschild.Issuances
  ADD COLUMN name TEXT;

# allow update to not require a primary key in where clause
SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.Issuances
SET
  name = CONCAT('issuance: ', id)
WHERE NAME IS NULL;

# turn on safe updates again
SET SQL_SAFE_UPDATES = 1;

ALTER TABLE rothschild.Issuances
  MODIFY COLUMN name TEXT NOT NULL;
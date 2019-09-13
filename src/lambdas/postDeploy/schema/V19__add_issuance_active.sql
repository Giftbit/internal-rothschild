ALTER TABLE rothschild.Issuances
  ADD COLUMN active BOOLEAN DEFAULT NULL;

SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.Issuances
SET
  active = TRUE
WHERE active IS NULL;

SET SQL_SAFE_UPDATES = 1;

ALTER TABLE rothschild.Issuances
  MODIFY COLUMN active BOOLEAN NOT NULL;
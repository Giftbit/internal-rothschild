SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.Issuances
  ADD COLUMN createdBy VARCHAR(64);

UPDATE rothschild.Issuances
SET createdBy = userId
WHERE createdBy IS NULL;

ALTER TABLE rothschild.Issuances
  MODIFY COLUMN createdBy VARCHAR(64) NOT NULL;

SET SQL_SAFE_UPDATES = 1;
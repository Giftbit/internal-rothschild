SET SQL_SAFE_UPDATES = 0;

ALTER TABLE rothschild.`Transactions`
  ADD COLUMN createdBy VARCHAR(64);
ALTER TABLE rothschild.`Programs`
  ADD COLUMN createdBy VARCHAR(64);
ALTER TABLE rothschild.`Values`
  ADD COLUMN createdBy VARCHAR(64);
ALTER TABLE rothschild.`Contacts`
  ADD COLUMN createdBy VARCHAR(64);


UPDATE rothschild . `Transactions`
SET createdBy = userId
WHERE CREATEDBY IS NULL;

UPDATE rothschild . `Programs`
SET createdBy = userId
WHERE CREATEDBY IS NULL;

UPDATE rothschild . `Values`
SET createdBy = userId
WHERE CREATEDBY IS NULL;

UPDATE rothschild . `Contacts`
SET createdBy = userId
WHERE CREATEDBY IS NULL;


ALTER TABLE rothschild.`Transactions`
  MODIFY COLUMN createdBy VARCHAR(64) NOT NULL;
ALTER TABLE rothschild.`Programs`
  MODIFY COLUMN createdBy VARCHAR(64) NOT NULL;
ALTER TABLE rothschild.`Values`
  MODIFY COLUMN createdBy VARCHAR(64) NOT NULL;
ALTER TABLE rothschild.`Contacts`
  MODIFY COLUMN createdBy VARCHAR(64) NOT NULL;


SET SQL_SAFE_UPDATES = 1;

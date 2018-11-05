ALTER TABLE rothschild.`Contacts`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Programs`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Issuances`
  MODIFY COLUMN programId VARCHAR(64) NOT NULL,
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Values`
  MODIFY COLUMN contactId VARCHAR(64) DEFAULT NULL,
  MODIFY COLUMN programId VARCHAR(64) DEFAULT NULL,
  MODIFY COLUMN issuanceId VARCHAR(64) DEFAULT NULL,
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Transactions`
  MODIFY COLUMN rootTransactionId VARCHAR(64) NOT NULL,
  MODIFY COLUMN nextTransactionId VARCHAR(64) DEFAULT NULL,
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`InternalTransactionSteps`
  MODIFY COLUMN transactionId VARCHAR(64) NOT NULL,
  MODIFY COLUMN id VARCHAR(96) NOT NULL,
  DROP FOREIGN KEY fk_InternalTransactionSteps_Transactions;

ALTER TABLE rothschild.`LightrailTransactionSteps`
  MODIFY COLUMN valueId VARCHAR(64) NOT NULL,
  MODIFY COLUMN contactId VARCHAR(64) DEFAULT NULL,
  MODIFY COLUMN transactionId VARCHAR(64) NOT NULL,
  MODIFY COLUMN id VARCHAR(96) NOT NULL;

ALTER TABLE rothschild.`StripeTransactionSteps`
  MODIFY COLUMN transactionId VARCHAR(64) NOT NULL,
  MODIFY COLUMN id VARCHAR(96) NOT NULL;

ALTER TABLE rothschild.`ValueTags`
  MODIFY COLUMN valueId VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`ProgramTags`
  MODIFY COLUMN programId VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`InternalTransactionSteps`
  DROP INDEX is_InternalTransactionSteps_transactionId;

ALTER TABLE rothschild.`InternalTransactionSteps`
  ADD INDEX ix_InternalTransactionSteps_transactionId (userId, transactionId);

ALTER TABLE rothschild.`InternalTransactionSteps`
  ADD CONSTRAINT fk_InternalTransactionSteps_Transactions FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, id);
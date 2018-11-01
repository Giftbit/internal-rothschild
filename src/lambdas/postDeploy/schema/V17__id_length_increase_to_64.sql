ALTER TABLE rothschild.`Contacts`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Programs`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Issuances`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Values`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`Transactions`
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.`InternalTransactionSteps`
  MODIFY COLUMN id VARCHAR(96) NOT NULL;

ALTER TABLE rothschild.`LightrailTransactionSteps`
  MODIFY COLUMN id VARCHAR(96) NOT NULL;

ALTER TABLE rothschild.`StripeTransactionSteps`
  MODIFY COLUMN id VARCHAR(96) NOT NULL;


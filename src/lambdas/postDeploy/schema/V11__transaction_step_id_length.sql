ALTER TABLE rothschild.LightrailTransactionSteps
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.StripeTransactionSteps
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.InternalTransactionSteps
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.Transactions
  ADD COLUMN rootTransactionId VARCHAR(32),
  ADD COLUMN nextTransactionId VARCHAR(32),
  ADD CONSTRAINT fk_Transacitons_rootTransactionId FOREIGN KEY (userId, rootTransactionId) REFERENCES rothschild.Transactions (userId, id),
  ADD CONSTRAINT fk_Transacitons_nextTransactionId FOREIGN KEY (userId, nextTransactionId) REFERENCES rothschild.Transactions (userId, id);

SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.Transactions
SET rootTransactionId = id
WHERE rootTransactionId IS NULL;

ALTER TABLE rothschild.Transactions
  MODIFY COLUMN rootTransactionId VARCHAR(32) NOT NULL;

SET SQL_SAFE_UPDATES = 1;


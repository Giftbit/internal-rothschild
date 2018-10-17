ALTER TABLE rothschild.Transactions
  ADD COLUMN rootTransactionId VARCHAR(32),
  ADD COLUMN nextTransactionId VARCHAR(32);

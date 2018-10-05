ALTER TABLE rothschild.Transactions
  ADD COLUMN rootChainTransactionId VARCHAR(32),
  ADD COLUMN nextChainTransactionId VARCHAR(32);

ALTER TABLE rothschild.`Transactions`
  ADD pendingVoidDate DATETIME DEFAULT NULL;

ALTER TABLE rothschild.`Transactions`
  ADD INDEX ix_Transactions_pendingVoidDate (pendingVoidDate);

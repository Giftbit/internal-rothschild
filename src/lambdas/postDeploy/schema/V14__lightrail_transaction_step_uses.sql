ALTER TABLE rothschild.LightrailTransactionSteps
  MODIFY balanceBefore INT DEFAULT NULL,
  MODIFY balanceAfter INT DEFAULT NULL,
# leave balanceChange as NOT NULL
  ADD COLUMN usesRemainingBefore INT DEFAULT NULL,
  ADD COLUMN usesRemainingAfter INT DEFAULT NULL,
  ADD COLUMN usesRemainingChange INT DEFAULT NULL;

ALTER TABLE rothschild.Transactions
  ADD COLUMN createdBy VARCHAR(64);

ALTER TABLE rothschild.Programs
  ADD COLUMN createdBy VARCHAR(64);

ALTER TABLE rothschild.Values
  ADD COLUMN createdBy VARCHAR(64);

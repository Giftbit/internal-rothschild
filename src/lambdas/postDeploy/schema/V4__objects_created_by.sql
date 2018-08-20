ALTER TABLE rothschild.Transactions
  ADD COLUMN createdBy VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.Programs
  ADD COLUMN createdBy VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.Values
  ADD COLUMN createdBy VARCHAR(64) NOT NULL;

ALTER TABLE rothschild.Contacts
  ADD COLUMN createdBy VARCHAR(64) NOT NULL;

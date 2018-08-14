ALTER TABLE rothschild.Transactions
  ADD INDEX ix_Transactions_createdDate (createdDate);

ALTER TABLE rothschild.Values
  ADD INDEX ix_Values_createdDate (createdDate);

ALTER TABLE rothschild.Contacts
  ADD INDEX ix_Contacts_createdDate (createdDate);

ALTER TABLE rothschild.Programs
  ADD INDEX ix_Programs_createdDate (createdDate);

ALTER TABLE rothschild.Issuances
  ADD INDEX ix_Programs_createdDate (createdDate);

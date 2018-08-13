ALTER TABLE rothschild.Transactions
  ADD INDEX ix_Transactions_createdDate (createdDate);

ALTER TABLE rothschild.Values
  ADD INDEX ix_Values_updatedDate (updatedDate);

ALTER TABLE rothschild.Contacts
  ADD INDEX ix_Contacts_updatedDate (updatedDate);

ALTER TABLE rothschild.Programs
  ADD INDEX ix_Programs_createdDate (updatedDate);

ALTER TABLE rothschild.Issuances
  ADD INDEX ix_Programs_createdDate (createdDate);

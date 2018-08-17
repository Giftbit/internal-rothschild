ALTER TABLE rothschild.Transactions
  ADD INDEX ix_Transactions_createdDate (createdDate),
  ADD INDEX ix_Transactions_userId (userId);

ALTER TABLE rothschild.Values
  ADD INDEX ix_Values_createdDate (createdDate),
  ADD INDEX ix_Values_userId (userId);

ALTER TABLE rothschild.Contacts
  ADD INDEX ix_Contacts_createdDate (createdDate),
  ADD INDEX ix_Contacts_userId (userId);

ALTER TABLE rothschild.Programs
  ADD INDEX ix_Programs_createdDate (createdDate),
  ADD INDEX ix_Programs_userId (userId);

ALTER TABLE rothschild.Issuances
  ADD INDEX ix_Issuances_createdDate (createdDate),
  ADD INDEX ix_Issuances_userId (userId);

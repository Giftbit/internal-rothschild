CREATE DATABASE rothschild;

CREATE TABLE rothschild.schemaChanges (
  schemaChangeId int NOT NULL,
  scriptName VARCHAR(32),
  dateApplied DATETIME
);

CREATE TABLE rothschild.contacts (
  platformUserId VARCHAR(32) NOT NULL,
  contactId VARCHAR(32) NOT NULL,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  email TEXT NOT NULL,
  PRIMARY KEY (contactId, platformUserId)
);

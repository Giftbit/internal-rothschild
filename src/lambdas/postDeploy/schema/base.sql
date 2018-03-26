CREATE DATABASE rothschild;

-- Stores what schema updates have been applied.  Not married to the specific columns.
CREATE TABLE rothschild.schemaChanges (
  schemaChangeId int NOT NULL,
  scriptName VARCHAR(255),
  dateApplied DATETIME
);

CREATE TABLE rothschild.customers (
  userId VARCHAR(255) NOT NULL,
  customerId VARCHAR(255) NOT NULL,
  firstName TEXT,
  lastName TEXT,
  email TEXT,
  PRIMARY KEY (customerId, userId)
);

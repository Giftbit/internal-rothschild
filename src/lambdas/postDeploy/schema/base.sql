CREATE DATABASE rothschild;

CREATE TABLE rothschild.schemaChanges (
  schemaChangeId int NOT NULL,
  scriptName VARCHAR(32),
  dateApplied DATETIME
);

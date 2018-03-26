CREATE DATABASE rothschild;

-- Stores what schema updates have been applied.  Not married to the specific columns.
CREATE TABLE rothschild.SchemaChanges (
  schemaChangeId INT NOT NULL,
  scriptName VARCHAR(255),
  dateApplied DATETIME
);

-- The actual schema.
CREATE TABLE rothschild.Customers (
  userId VARCHAR(255) NOT NULL,
  customerId VARCHAR(255) NOT NULL,
  email VARCHAR(320),
  firstName NVARCHAR(255),
  lastName NVARCHAR(255),
  PRIMARY KEY (userId, customerId)
);

CREATE TABLE rothschild.ValueStoreTemplates (
  userId VARCHAR(255) NOT NULL,
  valueStoreTemplateId VARCHAR(255) NOT NULL,
  valueStoreType VARCHAR(255),
  value INT,
  minInitialValue INT,
  maxInitialValue INT,
  currency VARCHAR(16) NOT NULL,
  startDate DATETIME,
  endDate DATETIME,
  validityDurationDays INT,
  uses INT,
  redemptionRule TEXT,
  valueRule TEXT,
  PRIMARY KEY (userId, valueStoreTemplateId)
);

CREATE TABLE rothschild.ValueStores (
  userId VARCHAR(255) NOT NULL,
  valueStoreId VARCHAR(255) NOT NULL,
  valueType VARCHAR(255) NOT NULL,
  value INT NOT NULL,
  currency VARCHAR(16) NOT NULL,
  active BOOL NOT NULL,
  expired BOOL NOT NULL,
  frozen BOOL NOT NULL,
  redemptionRule TEXT,
  valueRule TEXT,
  createdDate DATETIME NOT NULL,
  lastUpdatedDate DATETIME NOT NULL,
  startDate DATETIME NOT NULL,
  endDate DATETIME,
  usesLeft INT,
  valueStoreTemplateId VARCHAR(255),
  PRIMARY KEY (userId, valueStoreId),
  CONSTRAINT valueStores_fk0 FOREIGN KEY (userId, valueStoreTemplateId) REFERENCES rothschild.ValueStoreTemplates(userId, valueStoreTemplateId)
);

CREATE TABLE rothschild.Transactions (
  userId VARCHAR(255) NOT NULL,
  transactionId VARCHAR(255) NOT NULL,
  customerId VARCHAR(255) NOT NULL,
  cart TEXT NOT NULL,
  createdDate DATETIME NOT NULL,
  requestedValueStores TEXT NOT NULL,
  requestedPaymentSources TEXT NOT NULL,
  PRIMARY KEY (userId, transactionId),
  CONSTRAINT transactions_fk0 FOREIGN KEY (userId, customerId) REFERENCES rothschild.Customers(userId, customerId)
);

CREATE TABLE rothschild.LightrailTransactionLegs (
  userId VARCHAR(255) NOT NULL,
  transactionLegId VARCHAR(255) NOT NULL,
  transactionId VARCHAR(255),
  valueStoreId VARCHAR(255) NOT NULL,
  value INT NOT NULL,
  createdDate DATETIME NOT NULL,
  type VARCHAR(255) NOT NULL,
  PRIMARY KEY (userId, transactionLegId),
  CONSTRAINT lightrailTransactionLegs_fk0 FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, transactionId),
  CONSTRAINT lightrailTransactionLegs_fk1 FOREIGN KEY (userId, valueStoreId) REFERENCES rothschild.ValueStores(userId, valueStoreId)
);

CREATE TABLE rothschild.ExternalTransactionLegs (
  userId VARCHAR(255) NOT NULL,
  paymentId VARCHAR(255) NOT NULL,
  transactionId VARCHAR(255) NOT NULL,
  value INT NOT NULL,
  currency VARCHAR(16) NOT NULL,
  ccLastFour VARCHAR(4) NOT NULL,
  cardFingerprint VARCHAR(255) NOT NULL,
  PRIMARY KEY (userId, paymentId),
  CONSTRAINT externalTransactionLegs_fk0 FOREIGN KEY (userId, transactionId) REFERENCES rothschild.LightrailTransactionLegs (userId, transactionId)
);

CREATE TABLE rothschild.ValueStoreAccess (
  userId VARCHAR(255) NOT NULL,
  valueStoreAccessId VARCHAR(255) NOT NULL,
  code VARCHAR(255),
  valueStoreId VARCHAR(255) NOT NULL,
  accessType VARCHAR(255) NOT NULL,
  customerId VARCHAR(255),
  PRIMARY KEY (userId, valueStoreAccessId),
  CONSTRAINT valueStoreAccess_fk0 FOREIGN KEY (userId, valueStoreId) REFERENCES rothschild.ValueStores(userId, valueStoreId),
  CONSTRAINT valueStoreAccess_fk1 FOREIGN KEY (userId, customerId) REFERENCES rothschild.Customers(userId, customerId)
);

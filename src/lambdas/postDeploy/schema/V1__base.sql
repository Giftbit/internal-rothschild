CREATE TABLE rothschild.Customers (
  userId      VARCHAR(255) NOT NULL,
  customerId  VARCHAR(255) NOT NULL,
  email       VARCHAR(320),
  firstName   NVARCHAR(255),
  lastName    NVARCHAR(255),
  metadata    TEXT,
  createdDate DATETIME     NOT NULL,
  updatedDate DATETIME     NOT NULL,
  PRIMARY KEY (userId, customerId)
);

CREATE TABLE rothschild.Currencies (
  userId        VARCHAR(255) NOT NULL,
  code          VARCHAR(16)  NOT NULL,
  name          VARCHAR(255) NOT NULL,
  symbol        VARCHAR(16)  NOT NULL,
  decimalPlaces INT          NOT NULL,
  PRIMARY KEY (userId, code)
);

CREATE TABLE rothschild.ValueStoreTemplates (
  userId               VARCHAR(255) NOT NULL,
  valueStoreTemplateId VARCHAR(255) NOT NULL,
  valueStoreType       VARCHAR(255),
  initialValue         INT,
  pretax               BOOL         NOT NULL,
  minInitialValue      INT,
  maxInitialValue      INT,
  currency             VARCHAR(16)  NOT NULL,
  startDate            DATETIME,
  endDate              DATETIME,
  validityDurationDays INT,
  uses                 INT,
  redemptionRule       TEXT,
  valueRule            TEXT,
  metadata             TEXT,
  createdDate          DATETIME     NOT NULL,
  updatedDate          DATETIME     NOT NULL,
  PRIMARY KEY (userId, valueStoreTemplateId),
  CONSTRAINT valueStoreTemplates_currency FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code)
);

CREATE TABLE rothschild.ValueStores (
  userId               VARCHAR(255) NOT NULL,
  valueStoreId         VARCHAR(255) NOT NULL,
  valueStoreType       VARCHAR(255) NOT NULL,
  value                INT          NOT NULL,
  pretax               BOOL         NOT NULL,
  currency             VARCHAR(16)  NOT NULL,
  active               BOOL         NOT NULL,
  expired              BOOL         NOT NULL,
  frozen               BOOL         NOT NULL,
  redemptionRule       TEXT,
  valueRule            TEXT,
  startDate            DATETIME,
  endDate              DATETIME,
  uses                 INT,
  valueStoreTemplateId VARCHAR(255),
  metadata             TEXT,
  createdDate          DATETIME     NOT NULL,
  updatedDate          DATETIME     NOT NULL,
  PRIMARY KEY (userId, valueStoreId),
  CONSTRAINT valueStores_valueStoreTemplate FOREIGN KEY (userId, valueStoreTemplateId) REFERENCES rothschild.ValueStoreTemplates (userId, valueStoreTemplateId),
  CONSTRAINT valueStores_currency FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code)
);

CREATE TABLE rothschild.Transactions (
  userId                  VARCHAR(255) NOT NULL,
  transactionId           VARCHAR(255) NOT NULL,
  transactionType         VARCHAR(255) NOT NULL,
  cart                    MEDIUMTEXT,
  requestedPaymentSources TEXT,
  remainder               INT          NOT NULL,
  createdDate             DATETIME     NOT NULL,
  PRIMARY KEY (userId, transactionId)
);

CREATE TABLE rothschild.LightrailTransactionSteps (
  userId                     VARCHAR(255) NOT NULL,
  lightrailTransactionStepId VARCHAR(255) NOT NULL,
  transactionId              VARCHAR(255) NOT NULL,
  valueStoreId               VARCHAR(255) NOT NULL,
  customerId                 VARCHAR(255),
  codeLastFour               VARCHAR(4),
  valueBefore                INT          NOT NULL,
  valueAfter                 INT          NOT NULL,
  valueChange                INT          NOT NULL,
  createdDate                DATETIME     NOT NULL,
  PRIMARY KEY (userId, lightrailTransactionStepId),
  INDEX lightrailTransactionSteps_ix0 (userId, transactionId),
  CONSTRAINT lightrailTransactionSteps_transaction FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, transactionId),
  CONSTRAINT lightrailTransactionSteps_valueStore FOREIGN KEY (userId, valueStoreId) REFERENCES rothschild.ValueStores (userId, valueStoreId),
  CONSTRAINT lightrailTransactionSteps_customer FOREIGN KEY (userId, customerId) REFERENCES rothschild.Customers (userId, customerId)
);

CREATE TABLE rothschild.StripeTransactionSteps (
  userId                  VARCHAR(255) NOT NULL,
  stripeTransactionStepId VARCHAR(255) NOT NULL,
  transactionId           VARCHAR(255) NOT NULL,
  chargeId                VARCHAR(255) NOT NULL,
  currency                CHAR(3)      NOT NULL,
  amount                  INT          NOT NULL,
  charge                  MEDIUMTEXT   NOT NULL,
  PRIMARY KEY (userId, stripeTransactionStepId),
  INDEX stripeTransactionSteps_ix0 (userId, transactionId),
  CONSTRAINT stripeTransactionSteps_transaction FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, transactionId),
  CONSTRAINT stripeTransactionSteps_code FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code)
);

CREATE TABLE rothschild.InternalTransactionSteps (
  userId                    VARCHAR(255) NOT NULL,
  internalTransactionStepId VARCHAR(255) NOT NULL,
  transactionId             VARCHAR(255) NOT NULL,
  id                        VARCHAR(255) NOT NULL,
  valueBefore               INT          NOT NULL,
  valueAfter                INT          NOT NULL,
  valueChange               INT          NOT NULL,
  PRIMARY KEY (userId, internalTransactionStepId),
  INDEX internalTransactionSteps_ix0 (userId, transactionId),
  CONSTRAINT internalTransactionSteps_transaction FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, transactionId)
);

CREATE TABLE rothschild.ValueStoreAccess (
  userId             VARCHAR(255) NOT NULL,
  valueStoreAccessId VARCHAR(255) NOT NULL,
  valueStoreId       VARCHAR(255) NOT NULL,
  code               VARCHAR(255),
  codeHashed         VARCHAR(255),
  codeLastFour       VARCHAR(4),
  customerId         VARCHAR(255),
  createdDate        DATETIME     NOT NULL,
  updatedDate        DATETIME     NOT NULL,
  PRIMARY KEY (userId, valueStoreAccessId),
  CONSTRAINT valueStoreAccess_code UNIQUE (userId, code),
  CONSTRAINT valueStoreAccess_codeHashed UNIQUE (userId, codeHashed),
  CONSTRAINT valueStoreAccess_valueStore FOREIGN KEY (userId, valueStoreId) REFERENCES rothschild.ValueStores (userId, valueStoreId),
  CONSTRAINT valueStoreAccess_customer FOREIGN KEY (userId, customerId) REFERENCES rothschild.Customers (userId, customerId)
);

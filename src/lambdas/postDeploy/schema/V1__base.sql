# All indices and constraints should be named so they can be referenced in the code.
# Key and constraint naming conventions:
#   - PRIMARY KEY: pk_<table name>
#   - FOREIGN KEY: fk_<table name>_<foreign table name>
#   - INDEX: ix_<table name>_<indexed field>(_<indexed field>)*
#     - skip userId as an indexed field name because it's common and boring
#   - UNIQUE: uq_<table name>_<unique field>

CREATE TABLE rothschild.Contacts (
  userId      VARCHAR(32) NOT NULL,
  id          VARCHAR(32) NOT NULL,
  email       VARCHAR(320),
  firstName   NVARCHAR(255),
  lastName    NVARCHAR(255),
  metadata    TEXT,
  createdDate DATETIME    NOT NULL,
  updatedDate DATETIME    NOT NULL,
  PRIMARY KEY pk_Contacts (userId, id)
);

CREATE TABLE rothschild.Currencies (
  userId        VARCHAR(32)  NOT NULL,
  code          VARCHAR(16)  NOT NULL,
  name          VARCHAR(255) NOT NULL,
  symbol        VARCHAR(16)  NOT NULL,
  decimalPlaces INT          NOT NULL,
  PRIMARY KEY pk_Currencies (userId, code)
);

CREATE TABLE rothschild.Programs (
  userId               VARCHAR(32) NOT NULL,
  id                   VARCHAR(32) NOT NULL,
  name                 TEXT        NOT NULL,
  currency             VARCHAR(16) NOT NULL,
  discount             BOOL        NOT NULL,
  pretax               BOOL        NOT NULL,
  active               BOOL        NOT NULL,
  redemptionRule       TEXT,
  valueRule            TEXT,
  minInitialBalance    INT,
  maxInitialBalance    INT,
  fixedInitialBalances TEXT,
  fixedInitialUses     TEXT,
  startDate            DATETIME,
  endDate              DATETIME,
  metadata             TEXT,
  createdDate          DATETIME    NOT NULL,
  updatedDate          DATETIME    NOT NULL,
  PRIMARY KEY pk_Programs (userId, id),
  CONSTRAINT fk_Programs_Currencies FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code)
);

CREATE TABLE rothschild.ProgramTags (
  userId    VARCHAR(32) NOT NULL,
  programId VARCHAR(32) NOT NULL,
  tag       VARCHAR(32) NOT NULL,
  PRIMARY KEY pk_ProgramTags (userId, programId, tag),
  INDEX ix_ProgramTags_tag (userId, tag),
  CONSTRAINT fk_ProgramTags_Programs FOREIGN KEY (userId, programId) REFERENCES rothschild.Programs (userId, id)
);

CREATE TABLE rothschild.Values (
  userId         VARCHAR(32) NOT NULL,
  id             VARCHAR(32) NOT NULL,
  currency       VARCHAR(16) NOT NULL,
  balance        INT,
  uses           INT,
  programId      VARCHAR(32),
  code           VARCHAR(255),
  codeHashed     CHAR(255),
  codeLastFour   VARCHAR(4),
  contactId      VARCHAR(32),
  pretax         BOOL        NOT NULL,
  active         BOOL        NOT NULL,
  canceled       BOOL        NOT NULL,
  frozen         BOOL        NOT NULL,
  redemptionRule TEXT,
  valueRule      TEXT,
  discount       BOOL        NOT NULL,
  startDate      DATETIME,
  endDate        DATETIME,
  metadata       TEXT,
  createdDate    DATETIME    NOT NULL,
  updatedDate    DATETIME    NOT NULL,
  PRIMARY KEY pk_Values (userId, id),
  CONSTRAINT fk_Values_Programs FOREIGN KEY (userId, programId) REFERENCES rothschild.Programs (userId, id),
  CONSTRAINT fk_Values_Currencies FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code),
  CONSTRAINT fk_Values_Contacts FOREIGN KEY (userId, contactId) REFERENCES rothschild.Contacts (userId, id),
  CONSTRAINT uq_Values_code UNIQUE (userId, code),
  CONSTRAINT uq_Values_codeHashed UNIQUE (userId, codeHashed)
);

CREATE TABLE rothschild.ValueTags (
  userId  VARCHAR(32) NOT NULL,
  valueId VARCHAR(32) NOT NULL,
  tag     VARCHAR(32) NOT NULL,
  PRIMARY KEY pk_ValueTags (userId, valueId, tag),
  INDEX ix_ValueTags_tag (userId, tag),
  CONSTRAINT fk_ValueTags_Values FOREIGN KEY (userId, valueId) REFERENCES rothschild.Values (userId, id)
);

CREATE TABLE rothschild.Transactions (
  userId                  VARCHAR(32)  NOT NULL,
  id                      VARCHAR(32)  NOT NULL,
  transactionType         VARCHAR(255) NOT NULL,
  totals                  TEXT,
  lineItems               MEDIUMTEXT,
  paymentSources          TEXT,
  metadata                TEXT,
  createdDate             DATETIME     NOT NULL,
  PRIMARY KEY pk_Transactions (userId, id)
);

CREATE TABLE rothschild.LightrailTransactionSteps (
  userId        VARCHAR(32)  NOT NULL,
  id            VARCHAR(255) NOT NULL,
  transactionId VARCHAR(32)  NOT NULL,
  valueId       VARCHAR(32)  NOT NULL,
  contactId     VARCHAR(32),
  code          CHAR(4),
  balanceBefore INT          NOT NULL,
  balanceAfter  INT          NOT NULL,
  balanceChange INT          NOT NULL,
  PRIMARY KEY pk_LightrailTransactionSteps (userId, id),
  INDEX ix_LightrailTransactionSteps_transactionId (userId, transactionId),
  CONSTRAINT fk_LightrailTransactionSteps_Transactions FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, id),
  CONSTRAINT fk_LightrailTransactionSteps_Values FOREIGN KEY (userId, valueId) REFERENCES rothschild.Values (userId, id),
  CONSTRAINT fk_LightrailTransactionSteps_Contacts FOREIGN KEY (userId, contactId) REFERENCES rothschild.Contacts (userId, id)
);

CREATE TABLE rothschild.StripeTransactionSteps (
  userId        VARCHAR(32)  NOT NULL,
  id            VARCHAR(255) NOT NULL,
  transactionId VARCHAR(255) NOT NULL,
  chargeId      VARCHAR(255) NOT NULL,
  currency      CHAR(3)      NOT NULL,
  amount        INT          NOT NULL,
  charge        MEDIUMTEXT   NOT NULL,
  PRIMARY KEY pk_StripeTransactionSteps (userId, id),
  INDEX ix_StripeTransactionSteps_transactionId (userId, transactionId),
  CONSTRAINT fk_StripeTransactionSteps_Transactions FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, id),
  CONSTRAINT fk_StripeTransactionSteps_Currencies FOREIGN KEY (userId, currency) REFERENCES rothschild.Currencies (userId, code)
);

CREATE TABLE rothschild.InternalTransactionSteps (
  userId        VARCHAR(32)  NOT NULL,
  id            VARCHAR(255) NOT NULL,
  transactionId VARCHAR(255) NOT NULL,
  internalId    VARCHAR(255) NOT NULL,
  balanceBefore INT          NOT NULL,
  balanceAfter  INT          NOT NULL,
  balanceChange INT          NOT NULL,
  PRIMARY KEY pk_InternalTransactionSteps (userId, id),
  INDEX is_InternalTransactionSteps_transactionId (userId, transactionId),
  CONSTRAINT fk_InternalTransactionSteps_Transactions FOREIGN KEY (userId, transactionId) REFERENCES rothschild.Transactions (userId, id)
);

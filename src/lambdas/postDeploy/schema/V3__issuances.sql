CREATE TABLE rothschild.Issuances (
  userId         VARCHAR(64) NOT NULL,
  id             VARCHAR(32) NOT NULL,
  programId      VARCHAR(32) NOT NULL,
  count          INT         NOT NULL,
  balance        INT,
  valueRule      TEXT,
  redemptionRule TEXT,
  uses           INT,
  startDate      DATETIME,
  endDate        DATETIME,
  metadata       TEXT,
  createdDate    DATETIME    NOT NULL,
  updatedDate    DATETIME    NOT NULL,
  PRIMARY KEY pk_Issuances (userId, id),
  CONSTRAINT fk_Issuances_Programs FOREIGN KEY (userId, programId) REFERENCES rothschild.Programs (userId, id)
);

ALTER TABLE rothschild.Values
  ADD COLUMN issuanceId VARCHAR(32),
  ADD CONSTRAINT fk_Values_Issuances FOREIGN KEY (userId, issuanceId) REFERENCES rothschild.Issuances (userId, id);

ALTER DATABASE rothschild DEFAULT CHARSET ascii;
ALTER DATABASE rothschild DEFAULT COLLATE ascii_bin;

# Updates to currency code do not use an indexed key in the WHERE clause and are thus unsafe.
SET SQL_SAFE_UPDATES = 0;

UPDATE rothschild.`Values`
SET currency = UPPER(currency)
WHERE currency != UPPER(currency) COLLATE latin1_bin;

UPDATE rothschild.`Programs`
SET currency = UPPER(currency)
WHERE currency != UPPER(currency) COLLATE latin1_bin;

UPDATE rothschild.`Transactions`
SET currency = UPPER(currency)
WHERE currency != UPPER(currency) COLLATE latin1_bin;

UPDATE rothschild.`Currencies`
SET code = UPPER(code)
WHERE code != UPPER(code) COLLATE latin1_bin;

SET SQL_SAFE_UPDATES = 1;

# Foreign keys require two columns to have the same collation.  We can only change them
# safely if we drop the foreign key and then recreate it.  Or we can do this dangerous
# thing and just be really careful.
# How can we check that this migration is correct?  Get the full schema and apply it
# to a local test database.  Check that all tables create (eventually, ignoring the out
# of order dependencies).
SET FOREIGN_KEY_CHECKS = 0;

ALTER TABLE rothschild.`ContactValues`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN valueId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN contactId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`Contacts`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
    MODIFY COLUMN createdBy VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`Currencies`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN createdBy VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`InternalTransactionSteps`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(96) COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN transactionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN internalId VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`Issuances`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN programId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN createdBy VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`LightrailTransactionSteps`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN valueId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN contactId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN transactionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`Programs`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN currency VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN fixedInitialBalances text CHARACTER SET utf8mb4,
    MODIFY COLUMN fixedInitialUsesRemaining text CHARACTER SET utf8mb4,
    MODIFY COLUMN createdBy VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`ProgramTags`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN programId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN tag VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`StripeTransactionSteps`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN transactionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN chargeId VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`TransactionChainBlockers`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN transactionId VARCHAR(64) COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN metadata text CHARACTER SET utf8mb4 NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`Transactions`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN transactionType VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN currency VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN totals text CHARACTER SET utf8mb4,
    MODIFY COLUMN rootTransactionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN nextTransactionId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN createdBy VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`Values`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN currency VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN contactId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN programId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN codeEncrypted VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN codeHashed VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN issuanceId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN attachedFromValueId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
    MODIFY COLUMN createdBy VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

ALTER TABLE rothschild.`ValueTags`
    MODIFY COLUMN userId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN valueId VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN tag VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    DEFAULT CHARSET ascii,
    DEFAULT COLLATE ascii_bin;

SET FOREIGN_KEY_CHECKS = 1;
